const { Router } = require('express');
const supabase   = require('../config/supabase');
const { requireAuth, attachUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { IdParamSchema, CreateUserSchema, RoleSchema } = require('../validation/schemas');
const { hasActiveSellerObligations } = require('../services/roleGuard');
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

  if (error) return res.status(500).json({ error: 'Internal server error' });
  res.status(201).json(data);
});

// PATCH /api/users/:id/role — the profile owner may change their own role
// (but not grant themselves admin), or an existing admin may change anyone's.
router.patch(
  '/:id/role',
  requireAuth,
  validate(IdParamSchema, 'params'),
  validate(RoleSchema),
  attachUser,
  async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const isAdmin = req.user.role === 'admin';

    const { data: target, error: targetErr } = await supabase
      .from('users').select('id, wallet, role').eq('id', id).single();
    if (targetErr || !target) return res.status(404).json({ error: 'User not found' });

    const isSelf = target.wallet === req.wallet;
    if (!isSelf && !isAdmin)
      return res.status(403).json({ error: "Cannot modify another user's role" });

    if (role === 'admin' && !isAdmin)
      return res.status(403).json({ error: 'Only an existing admin can grant the admin role' });

    // Dropping seller capability while a listing or deal still depends on
    // this wallet as seller would orphan it — there's no cascade handling
    // (closing listings, resolving deals) yet, so block it instead. An
    // admin can still force this through, e.g. as part of banning someone.
    if (!isAdmin && role === 'buyer' && ['seller', 'both'].includes(target.role)) {
      const blocked = await hasActiveSellerObligations(target.id, target.wallet);
      if (blocked) {
        return res.status(409).json({
          error: 'Cannot downgrade to buyer while you have an active listing or an in-progress deal as seller',
        });
      }
    }

    const { data, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Internal server error' });
    res.json(data);
  },
);

module.exports = router;
