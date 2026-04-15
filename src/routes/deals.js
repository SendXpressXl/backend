const { Router } = require('express');
const supabase   = require('../config/supabase');
const { lockFunds, releaseFunds, refund } = require('../services/escrow');
const router = Router();

const ESCROW_SECRET = process.env.ESCROW_SECRET_KEY;
const ESCROW_PUBLIC = process.env.ESCROW_PUBLIC_KEY;

// POST /api/deals
router.post('/', async (req, res) => {
  const { buyerSecret, seller, amount, description } = req.body;
  if (!buyerSecret || !seller || !amount || !description)
    return res.status(400).json({ error: 'Missing required fields' });

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
});

// GET /api/deals?userId=
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .or(`buyer.eq.${userId},seller.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/deals/:id/ship
router.post('/:id/ship', async (req, res) => {
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
router.post('/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const { buyerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== buyerId) return res.status(403).json({ error: 'Not the buyer' });
  if (deal.status !== 'shipped') return res.status(400).json({ error: 'Invalid deal status' });

  try {
    const txHash = await releaseFunds(ESCROW_SECRET, deal.seller, deal.amount, id);
    await supabase.from('deals').update({ status: 'confirmed', release_tx: txHash }).eq('id', id);
    res.json({ success: true, status: 'confirmed', tx_hash: txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deals/:id/dispute
router.post('/:id/dispute', async (req, res) => {
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
router.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const { buyerId } = req.body;

  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer !== buyerId) return res.status(403).json({ error: 'Not the buyer' });
  if (deal.status !== 'created') return res.status(400).json({ error: 'Can only cancel before shipment' });

  try {
    const txHash = await refund(ESCROW_SECRET, deal.buyer, deal.amount, id);
    await supabase.from('deals').update({ status: 'cancelled', refund_tx: txHash }).eq('id', id);
    res.json({ success: true, status: 'cancelled', tx_hash: txHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
