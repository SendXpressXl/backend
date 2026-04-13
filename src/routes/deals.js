const { Router } = require('express');
const supabase = require('../config/supabase');
const { server, networkPassphrase, StellarSdk } = require('../config/stellar');
const router = Router();

// POST /api/deals — create escrow deal on Stellar
router.post('/', async (req, res) => {
  // TODO:
  // 1. Build Stellar transaction (buyer → escrow holding account)
  // 2. Store deal in Supabase with status = 'created'
  // 3. Return deal + tx hash
  res.json({ todo: true });
});

// GET /api/deals?userId=
router.get('/', async (req, res) => {
  // TODO: fetch deals for user (as buyer or seller)
  res.json([]);
});

// POST /api/deals/:id/ship
router.post('/:id/ship', async (req, res) => {
  // TODO: seller marks shipped, update status in DB
  res.json({ todo: true });
});

// POST /api/deals/:id/confirm
router.post('/:id/confirm', async (req, res) => {
  // TODO:
  // 1. Build Stellar transaction (escrow → seller)
  // 2. Update deal status to 'confirmed'
  // 3. Return tx hash
  res.json({ todo: true });
});

// POST /api/deals/:id/dispute
router.post('/:id/dispute', async (req, res) => {
  // TODO: raise dispute, update status
  res.json({ todo: true });
});

// POST /api/deals/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  // TODO:
  // 1. Build Stellar transaction (escrow → buyer refund)
  // 2. Update deal status to 'cancelled'
  res.json({ todo: true });
});

module.exports = router;
