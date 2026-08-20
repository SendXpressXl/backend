const { Router } = require('express');
const supabase = require('../config/supabase');
const { releaseFunds, USDC_ASSET } = require('../services/escrow');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { IdParamSchema, MilestoneParamsSchema, CreateMilestoneDealSchema } = require('../validation/schemas');
const { canMilestoneTransition } = require('../services/dealStateMachine');
const { logTransition, expireStaleMilestones } = require('../services/dealTransitions');
const router = Router();

const ESCROW_SECRET = process.env.ESCROW_SECRET_KEY;

// POST /api/milestones/deals — create a deal with milestones in one shot.
// The deal starts in "created" status. The buyer must lock the full amount
// via the existing POST /api/deals/:id/submit-lock flow before any milestones
// can be shipped. This keeps milestone deals compatible with the standard
// escrow lifecycle.
router.post('/deals', requireAuth, validate(CreateMilestoneDealSchema), async (req, res) => {
  const { seller, amount, description, milestones } = req.body;

  try {
    // Create the parent deal flagged as milestone-aware
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .insert({
        buyer: req.wallet,
        seller,
        amount,
        description,
        status: 'created',
        is_milestone_deal: true,
      })
      .select()
      .single();
    if (dealErr) throw dealErr;

    // Insert all milestones with sequential ordering
    const milestoneRows = milestones.map((m, i) => ({
      deal_id: deal.id,
      sequence: i + 1,
      label: m.label,
      amount: m.amount,
      asset: 'native',
      status: 'pending',
    }));

    const { data: inserted, error: msErr } = await supabase
      .from('deal_milestones')
      .insert(milestoneRows)
      .select();
    if (msErr) throw msErr;

    res.status(201).json({ ...deal, milestones: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/milestones/deals/:id — get a deal with its milestones
router.get('/deals/:id', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('*')
    .eq('id', id)
    .single();
  if (dealErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== req.wallet && deal.seller !== req.wallet)
    return res.status(403).json({ error: 'Access denied' });

  const { data: milestones, error: msErr } = await supabase
    .from('deal_milestones')
    .select('*')
    .eq('deal_id', id)
    .order('sequence', { ascending: true });
  if (msErr) throw msErr;

  // Best-effort: expire milestones shipped too long without confirmation
  await expireStaleMilestones(id);

  res.json({ ...deal, milestones });
});

// POST /api/milestones/deals/:id/milestones/:milestoneId/ship
// Seller marks a milestone as shipped
router.post(
  '/deals/:id/milestones/:milestoneId/ship',
  requireAuth,
  validate(MilestoneParamsSchema, 'params'),
  async (req, res) => {
    const { id, milestoneId } = req.params;

    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .single();
    if (dealErr) return res.status(404).json({ error: 'Deal not found' });
    if (deal.seller !== req.wallet) return res.status(403).json({ error: 'Not the seller' });
    if (!deal.is_milestone_deal)
      return res.status(400).json({ error: 'Deal is not a milestone deal' });

    const { data: milestone, error: msErr } = await supabase
      .from('deal_milestones')
      .select('*')
      .eq('id', milestoneId)
      .eq('deal_id', id)
      .single();
    if (msErr) return res.status(404).json({ error: 'Milestone not found' });
    if (!canMilestoneTransition(milestone.status, 'shipped'))
      return res.status(400).json({ error: 'Invalid milestone status' });

    const { error: updErr } = await supabase
      .from('deal_milestones')
      .update({ status: 'shipped', updated_at: new Date().toISOString() })
      .eq('id', milestoneId)
      .eq('status', 'pending');
    if (updErr) return res.status(500).json({ error: updErr.message });

    await logTransition(id, req.wallet, `milestone:${milestone.sequence}:pending`, `milestone:${milestone.sequence}:shipped`);

    res.json({ success: true, milestoneId, status: 'shipped' });
  },
);

// POST /api/milestones/deals/:id/milestones/:milestoneId/confirm
// Buyer confirms a milestone, triggering partial fund release
router.post(
  '/deals/:id/milestones/:milestoneId/confirm',
  requireAuth,
  validate(MilestoneParamsSchema, 'params'),
  async (req, res) => {
    const { id, milestoneId } = req.params;

    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .single();
    if (dealErr) return res.status(404).json({ error: 'Deal not found' });
    if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });
    if (!deal.is_milestone_deal)
      return res.status(400).json({ error: 'Deal is not a milestone deal' });

    const { data: milestone, error: msErr } = await supabase
      .from('deal_milestones')
      .select('*')
      .eq('id', milestoneId)
      .eq('deal_id', id)
      .single();
    if (msErr) return res.status(404).json({ error: 'Milestone not found' });

    // Idempotent: already confirmed
    if (milestone.status === 'confirmed') {
      return res.json({ success: true, milestoneId, status: 'confirmed', tx_hash: milestone.release_tx });
    }

    // Crash recovery: still confirming but release_tx already stored
    if (milestone.status === 'confirming' && milestone.release_tx) {
      await supabase
        .from('deal_milestones')
        .update({ status: 'confirmed', updated_at: new Date().toISOString() })
        .eq('id', milestoneId);
      await logTransition(id, req.wallet, `milestone:${milestone.sequence}:confirming`, `milestone:${milestone.sequence}:confirmed`);
      return res.json({ success: true, milestoneId, status: 'confirmed', tx_hash: milestone.release_tx });
    }

    // Blocked: confirming but no release_tx yet
    if (milestone.status === 'confirming') {
      return res.status(409).json({ error: 'Milestone confirmation already in progress' });
    }

    if (!canMilestoneTransition(milestone.status, 'confirming'))
      return res.status(400).json({ error: 'Invalid milestone status' });

    // Flip to confirming first (optimistic lock)
    const { error: lockErr } = await supabase
      .from('deal_milestones')
      .update({ status: 'confirming', updated_at: new Date().toISOString() })
      .eq('id', milestoneId)
      .eq('status', 'shipped');
    if (lockErr) return res.status(500).json({ error: lockErr.message });
    await logTransition(id, req.wallet, `milestone:${milestone.sequence}:shipped`, `milestone:${milestone.sequence}:confirming`);

    try {
      const { hash: txHash, ledger: releaseLedger } = await releaseFunds(
        ESCROW_SECRET,
        deal.seller,
        milestone.amount,
        id,
        USDC_ASSET,
      );

      await supabase
        .from('deal_milestones')
        .update({
          release_tx: txHash,
          release_ledger: releaseLedger,
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', milestoneId);
      await logTransition(id, req.wallet, `milestone:${milestone.sequence}:confirming`, `milestone:${milestone.sequence}:confirmed`);

      // Check if all milestones are now confirmed — if so, finalize the deal
      const { data: remaining } = await supabase
        .from('deal_milestones')
        .select('id')
        .eq('deal_id', id)
        .neq('status', 'confirmed');

      if (!remaining || remaining.length === 0) {
        await supabase
          .from('deals')
          .update({ status: 'confirmed', release_tx: txHash })
          .eq('id', id)
          .eq('status', 'locked');
        await logTransition(id, req.wallet, 'locked', 'confirmed', 'all milestones confirmed');
      }

      res.json({ success: true, milestoneId, status: 'confirmed', tx_hash: txHash });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/milestones/deals/:id/milestones/:milestoneId/dispute
// Either party disputes a milestone
router.post(
  '/deals/:id/milestones/:milestoneId/dispute',
  requireAuth,
  validate(MilestoneParamsSchema, 'params'),
  async (req, res) => {
    const { id, milestoneId } = req.params;

    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .single();
    if (dealErr) return res.status(404).json({ error: 'Deal not found' });
    if (deal.buyer !== req.wallet && deal.seller !== req.wallet)
      return res.status(403).json({ error: 'Unauthorized' });
    if (!deal.is_milestone_deal)
      return res.status(400).json({ error: 'Deal is not a milestone deal' });

    const { data: milestone, error: msErr } = await supabase
      .from('deal_milestones')
      .select('*')
      .eq('id', milestoneId)
      .eq('deal_id', id)
      .single();
    if (msErr) return res.status(404).json({ error: 'Milestone not found' });
    if (!canMilestoneTransition(milestone.status, 'disputed'))
      return res.status(400).json({ error: 'Invalid milestone status' });

    const { error: updErr } = await supabase
      .from('deal_milestones')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', milestoneId)
      .neq('status', 'confirmed');
    if (updErr) return res.status(500).json({ error: updErr.message });

    await logTransition(id, req.wallet, `milestone:${milestone.sequence}:${milestone.status}`, `milestone:${milestone.sequence}:disputed`);

    // Only flag the parent deal as disputed if no other milestones have been
    // confirmed — otherwise keep it locked so the remaining milestones can
    // still be processed.
    const { data: confirmedMilestones } = await supabase
      .from('deal_milestones')
      .select('id')
      .eq('deal_id', id)
      .eq('status', 'confirmed');

    if (!confirmedMilestones || confirmedMilestones.length === 0) {
      await supabase
        .from('deals')
        .update({ status: 'disputed' })
        .eq('id', id)
        .eq('status', 'locked');
    }

    res.json({ success: true, milestoneId, status: 'disputed' });
  },
);

module.exports = router;
