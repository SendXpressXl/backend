const { Router } = require('express');
const supabase = require('../config/supabase');
const router = Router();

// GET /api/posts
router.get('/', async (req, res) => {
  // TODO: fetch posts with user join
  res.json([]);
});

// POST /api/posts
router.post('/', async (req, res) => {
  // TODO: create post
  res.json({ todo: true });
});

// POST /api/posts/:id/like
router.post('/:id/like', async (req, res) => {
  // TODO: toggle like
  res.json({ todo: true });
});

module.exports = router;
