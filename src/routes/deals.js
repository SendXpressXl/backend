const { Router } = require('express');
const supabase   = require('../config/supabase');
const { lockFunds, releaseFunds, refund } = require('../services/escrow');
const { validate } = require('../middleware/validate');
const {
  IdParamSchema,
  DealsQuerySchema,
  BuyerSecretHeaderSchema,
  CreateDealSchema,
  ShipDealSchema,
  ConfirmDealSchema,
  CancelDealSchema,
  DisputeDealSchema,
} = require('../validation/schemas');
const router = Router();

const ESCROW_SECRET = process.env.ESCROW_SECRET_KEY;
const ESCROW_PUBLIC = process.env.ESCROW_PUBLIC_KEY;

// POST /api/deals
// The buyer secret is taken from the redactable `x-buyer-secret` header, never
// the JSON body, so it does not land in request/error logs verbatim.
router.post(
  '/',
  validate(BuyerSecretHeaderSchema, 'headers'),
  validate(CreateDealSchema),
  async (req, res) => {
    const buyerSecret = req.headers['x-buyer-secret'];
    const { seller, amount, description } = req.body;

    try {
      const { StellarSdk } = require('../config/stellar');
      const buyerPublic = StellarSdk.Keypair.fromSecret(buyerSecret).publicKey();

      const { data: deal, error } = await supabase
        .from('deals')
        .insert({ buyer: buyerPublic, seller, amount, description, status: 'created' })
        .select()
        .single();
      if (error) throw error;

      const txHash = await lockFunds(buyerSecret, ESCROW_PUBLIC, amount, deal.id);
      await supabase.from('deals').update({ tx_hash: txHash }).eq('id', deal.id);

      res.status(201).json({ ...deal, tx_hash: txHash });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/deals?userId=
router.get('/', validate(DealsQuerySchema, 'query'), async (req, res) => {
  const { userId } = req.query;

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .or(`buyer.eq.${userId},seller.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/deals/:id
router.get('/:id', validate(IdParamSchema, 'params'), async (req, res) => {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Deal not found' });
  res.json(data);
});

// POST /api/deals/:id/ship
router.post('/:id/ship', validate(IdParamSchema, 'params'), validate(ShipDealSchema), async (req, res) => {
  const { id } = req.params;
  const { sellerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.seller !== sellerId) return res.status(403).json({ error: 'Not the seller' });
  if (deal.status !== 'created') return res.status(400).json({ error: 'Invalid deal status' });

  const { error } = await supabase
    .from('deals').update({ status: 'shipped' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, status: 'shipped' });
});

// POST /api/deals/:id/confirm
router.post('/:id/confirm', validate(IdParamSchema, 'params'), validate(ConfirmDealSchema), async (req, res) => {
  const { id } = req.params;
  const { buyerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== buyerId) return res.status(403).json({ error: 'Not the buyer' });

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
router.post('/:id/dispute', validate(IdParamSchema, 'params'), validate(DisputeDealSchema), async (req, res) => {
  const { id } = req.params;
  const { callerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== callerId && deal.seller !== callerId)
    return res.status(403).json({ error: 'Unauthorized' });
  if (!['created', 'shipped'].includes(deal.status))
    return res.status(400).json({ error: 'Invalid deal status' });

  const { error } = await supabase
    .from('deals').update({ status: 'disputed' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, status: 'disputed' });
});

// POST /api/deals/:id/cancel
router.post('/:id/cancel', validate(IdParamSchema, 'params'), validate(CancelDealSchema), async (req, res) => {
  const { id } = req.params;
  const { buyerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== buyerId) return res.status(403).json({ error: 'Not the buyer' });

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
