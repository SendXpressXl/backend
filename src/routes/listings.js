const { Router } = require('express');
const supabase = require('../config/supabase');
const router = Router();

// GET /api/listings
router.get('/', async (req, res) => {
  // TODO: fetch active listings with seller info
  res.json([]);
});

// POST /api/listings
router.post('/', async (req, res) => {
  // TODO: create listing (seller only)
  res.json({ todo: true });
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  // TODO: fetch single listing
  res.json({ todo: true });
});

module.exports = router;
