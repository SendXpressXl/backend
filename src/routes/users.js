const { Router } = require('express');
const supabase   = require('../config/supabase');
const router = Router();

// GET /api/users/:wallet
router.get('/:wallet', async (req, res) => {
  const { wallet } = req.params;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('wallet', wallet)
    .single();

  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

// POST /api/users — create or return existing user by wallet
router.post('/', async (req, res) => {
  const { wallet, handle, display_name, avatar_url } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet is required' });

  const { data: existing } = await supabase
    .from('users').select('*').eq('wallet', wallet).single();
  if (existing) return res.json(existing);

  const { data, error } = await supabase
    .from('users')
    .insert({ wallet, handle, display_name, avatar_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Internal server error' });
  res.status(201).json(data);
});

// PATCH /api/users/:id/role
router.patch('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!['buyer', 'seller', 'both'].includes(role))
    return res.status(400).json({ error: 'role must be buyer, seller, or both' });

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Internal server error' });
  res.json(data);
});

module.exports = router;
