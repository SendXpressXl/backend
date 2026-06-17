const { Router } = require('express');
const supabase   = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { IdParamSchema, ListingsQuerySchema, CreateListingSchema } = require('../validation/schemas');
const router = Router();

// GET /api/listings
router.get('/', validate(ListingsQuerySchema, 'query'), async (req, res) => {
  const { category, search, minPrice, maxPrice } = req.query;

  let query = supabase
    .from('listings')
    .select('*, users(handle, display_name, avatar_url)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (category)               query = query.eq('category', category);
  if (search)                 query = query.ilike('title', `%${search}%`);
  if (minPrice !== undefined) query = query.gte('price', minPrice);
  if (maxPrice !== undefined) query = query.lte('price', maxPrice);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/listings
router.post('/', requireAuth, validate(CreateListingSchema), async (req, res) => {
  const { title, description, price, category, moq, ship_days, image_url } = req.body;

  // Derive seller_id from the authenticated wallet — any seller_id in the body is ignored
  const { data: seller } = await supabase
    .from('users').select('id, role').eq('wallet', req.wallet).single();
  if (!seller || !['seller', 'both'].includes(seller.role))
    return res.status(403).json({ error: 'Seller role required' });

  const { data, error } = await supabase
    .from('listings')
    .insert({ seller_id: seller.id, title, description, price, category, moq, ship_days, image_url, status: 'active' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/listings/:id
router.get('/:id', validate(IdParamSchema, 'params'), async (req, res) => {
  const { data, error } = await supabase
    .from('listings')
    .select('*, users(handle, display_name, avatar_url)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Listing not found' });
  res.json(data);
});

module.exports = router;
