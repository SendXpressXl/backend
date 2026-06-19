const { Router } = require('express');
const supabase   = require('../config/supabase');
const { buildLockTx, submitSignedTx, releaseFunds, refund } = require('../services/escrow');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { StellarSdk, networkPassphrase } = require('../config/stellar');
const { IdParamSchema, CreateDealSchema, SubmitLockSchema } = require('../validation/schemas');
const router = Router();

const ESCROW_SECRET = process.env.ESCROW_SECRET_KEY;
const ESCROW_PUBLIC = process.env.ESCROW_PUBLIC_KEY;

// GET /api/deals/lock-tx?amount=&dealId=
// Returns an unsigned XDR the buyer can sign client-side.
router.get('/lock-tx', requireAuth, async (req, res) => {
  const { amount, dealId } = req.query;
  if (!amount || !dealId) return res.status(400).json({ error: 'amount and dealId are required' });
  if (Number(amount) <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  
  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', dealId).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });
  if (deal.status !== 'created') return res.status(400).json({ error: 'Invalid deal status' });

  try {
    const xdr = await buildLockTx(req.wallet, ESCROW_PUBLIC, deal.amount, dealId);
    res.json({ xdr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/deals/:id/submit-lock — buyer submits a signed XDR envelope
router.post('/:id/submit-lock', requireAuth, validate(IdParamSchema, 'params'), validate(SubmitLockSchema), async (req, res) => {
  const { id } = req.params;
  const { signedXdr } = req.body;

  try {
    // 1. Fetch deal to validate XDR against it
    const { data: deal, error: fetchErr } = await supabase
      .from('deals').select('*').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
    if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });
    if (deal.status !== 'created') return res.status(400).json({ error: 'Invalid deal status' });
    if (deal.tx_hash) return res.status(409).json({ error: 'Funds already locked' });

    // Parse the signed XDR with the SDK v10+ API
    const tx          = new StellarSdk.Transaction(signedXdr, networkPassphrase);
    const buyerPublic = tx.source;

    // Verify the transaction was signed by the authenticated wallet
    if (buyerPublic !== req.wallet)
      return res.status(400).json({ error: 'Transaction source does not match authenticated wallet' });

    // Validate that the XDR contains exactly the payment we expect
    const ops = tx.operations;
    if (ops.length !== 1 || ops[0].type !== 'payment')
      return res.status(400).json({ error: 'XDR must contain exactly one payment operation' });
    if (ops[0].destination !== ESCROW_PUBLIC)
      return res.status(400).json({ error: 'Payment destination must be the escrow account' });
    if (!ops[0].asset.isNative())
      return res.status(400).json({ error: 'Payment must be in native XLM' });
    if (ops[0].amount !== String(deal.amount))
      return res.status(400).json({ error: 'Payment amount does not match declared deal amount' });

    // 2. Atomic update to prevent double-submit race condition
    const { data: lockingDeal, error: lockErr } = await supabase
      .from('deals')
      .update({ status: 'locking' })
      .eq('id', id)
      .eq('status', 'created')
      .is('tx_hash', null)
      .select()
      .single();

    if (lockErr || !lockingDeal) {
      return res.status(409).json({ error: 'Funds already locked or lock in progress' });
    }

    try {
      // Submit the Stellar transaction
      const txHash = await submitSignedTx(signedXdr);

      const { data: updatedDeal, error } = await supabase
        .from('deals')
        .update({ tx_hash: txHash, status: 'locked' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      res.status(200).json(updatedDeal);
    } catch (stellarErr) {
      // Revert status so they can retry if it was a transient failure
      await supabase.from('deals').update({ status: 'created' }).eq('id', id);
      throw stellarErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deals — creates the deal in the database
router.post('/', requireAuth, validate(CreateDealSchema), async (req, res) => {
  const { seller, amount, description } = req.body;
  try {
    const { data: deal, error } = await supabase
      .from('deals')
      .insert({ buyer: req.wallet, seller, amount, description, status: 'created' })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deals — scoped to the authenticated wallet
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .or(`buyer.eq.${req.wallet},seller.eq.${req.wallet}`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/deals/:id
router.get('/:id', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Deal not found' });
  if (data.buyer !== req.wallet && data.seller !== req.wallet)
    return res.status(403).json({ error: 'Access denied' });
  res.json(data);
});

// POST /api/deals/:id/ship
router.post('/:id/ship', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.seller !== req.wallet) return res.status(403).json({ error: 'Not the seller' });
  if (deal.status !== 'created') return res.status(400).json({ error: 'Invalid deal status' });

  const { error } = await supabase
    .from('deals').update({ status: 'shipped' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, status: 'shipped' });
});

// POST /api/deals/:id/confirm
router.post('/:id/confirm', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });

  if (deal.status === 'confirmed') {
    return res.json({ success: true, status: 'confirmed', tx_hash: deal.release_tx });
  }

  if (deal.status === 'confirming') {
    if (deal.release_tx) {
      await supabase.from('deals').update({ status: 'confirmed' }).eq('id', id);
      return res.json({ success: true, status: 'confirmed', tx_hash: deal.release_tx });
    }
    return res.status(409).json({ error: 'Deal confirmation already in progress' });
  }

  if (deal.status !== 'shipped') {
    return res.status(400).json({ error: 'Invalid deal status' });
  }

  const { data: locked, error: lockErr } = await supabase
    .from('deals')
    .update({ status: 'confirming' })
    .eq('id', id)
    .eq('status', 'shipped')
    .select()
    .single();

  if (lockErr || !locked) {
    return res.status(409).json({ error: 'Deal confirmation already in progress' });
  }

  try {
    const txHash = await releaseFunds(ESCROW_SECRET, locked.seller, locked.amount, id);
    await supabase.from('deals').update({ release_tx: txHash }).eq('id', id);
    await supabase.from('deals').update({ status: 'confirmed' }).eq('id', id);
    res.json({ success: true, status: 'confirmed', tx_hash: txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deals/:id/dispute
router.post('/:id/dispute', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== req.wallet && deal.seller !== req.wallet)
    return res.status(403).json({ error: 'Unauthorized' });
  if (!['created', 'shipped'].includes(deal.status))
    return res.status(400).json({ error: 'Invalid deal status' });

  const { error } = await supabase
    .from('deals').update({ status: 'disputed' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, status: 'disputed' });
});

// POST /api/deals/:id/cancel
router.post('/:id/cancel', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });

  if (deal.status === 'cancelled') {
    return res.json({ success: true, status: 'cancelled', tx_hash: deal.refund_tx });
  }

  if (deal.status === 'cancelling') {
    if (deal.refund_tx) {
      await supabase.from('deals').update({ status: 'cancelled' }).eq('id', id);
      return res.json({ success: true, status: 'cancelled', tx_hash: deal.refund_tx });
    }
    return res.status(409).json({ error: 'Deal cancellation already in progress' });
  }

  if (deal.status !== 'created') {
    return res.status(400).json({ error: 'Can only cancel before shipment' });
  }

  const { data: locked, error: lockErr } = await supabase
    .from('deals')
    .update({ status: 'cancelling' })
    .eq('id', id)
    .eq('status', 'created')
    .select()
    .single();

  if (lockErr || !locked) {
    return res.status(409).json({ error: 'Deal cancellation already in progress' });
  }

  try {
    const txHash = await refund(ESCROW_SECRET, locked.buyer, locked.amount, id);
    await supabase.from('deals').update({ refund_tx: txHash }).eq('id', id);
    await supabase.from('deals').update({ status: 'cancelled' }).eq('id', id);
    res.json({ success: true, status: 'cancelled', tx_hash: txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
