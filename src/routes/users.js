const { Router } = require('express');
const supabase   = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { CreateUserSchema, RoleSchema } = require('../validation/schemas');
const router = Router();

// GET /api/users/:wallet
router.get('/:wallet', async (req, res) => {
  const { wallet } = req.params;
  const { data, error } = await supabase
    .from('users').select('*').eq('wallet', wallet).single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

// POST /api/users — create or return existing user
router.post('/', requireAuth, validate(CreateUserSchema), async (req, res) => {
  const { handle, display_name, avatar_url } = req.body;

  // Wallet comes from the authenticated session — any wallet in the body is ignored
  const wallet = req.wallet;

  const { data: existing } = await supabase
    .from('users').select('*').eq('wallet', wallet).single();
  if (existing) return res.json(existing);

  const { data, error } = await supabase
    .from('users')
    .insert({ wallet, handle, display_name, avatar_url })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/users/:id/role — only the profile owner may change their own role
router.patch('/:id/role', requireAuth, validate(RoleSchema), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const { data: user } = await supabase
    .from('users').select('wallet').eq('id', id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.wallet !== req.wallet)
    return res.status(403).json({ error: 'Cannot modify another user's role' });

  const { data, error } = await supabase
    .from('users').update({ role }).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
