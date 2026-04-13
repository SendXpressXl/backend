const { Router } = require('express');
const supabase = require('../config/supabase');
const router = Router();

// GET /api/users/:wallet
router.get('/:wallet', async (req, res) => {
  // TODO: fetch user by wallet
  res.json({ todo: true });
});

// POST /api/users
router.post('/', async (req, res) => {
  // TODO: create or return existing user
  res.json({ todo: true });
});

// PATCH /api/users/:id/role
router.patch('/:id/role', async (req, res) => {
  // TODO: set user role
  res.json({ todo: true });
});

module.exports = router;
