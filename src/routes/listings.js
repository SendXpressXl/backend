const { Router } = require('express');
const supabase   = require('../config/supabase');
const router = Router();

// GET /api/listings
router.get('/', async (req, res) => {
  const { category, search } = req.query;

  let query = supabase
    .from('listings')
    .select('*, users(handle, display_name, avatar_url)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (category) query = query.eq('category', category);
  if (search)   query = query.ilike('title', `%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/listings
router.post('/', async (req, res) => {
  const { seller_id, title, description, price, category, moq, ship_days, image_url } = req.body;
  if (!seller_id || !title || !price)
    return res.status(400).json({ error: 'seller_id, title, and price are required' });

  const { data: seller } = await supabase
    .from('users').select('role').eq('id', seller_id).single();
  if (!seller || !['seller', 'both'].includes(seller.role))
    return res.status(403).json({ error: 'Seller role required' });

  const { data, error } = await supabase
    .from('listings')
    .insert({ seller_id, title, description, price, category, moq, ship_days, image_url, status: 'active' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('listings')
    .select('*, users(handle, display_name, avatar_url)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Listing not found' });
  res.json(data);
});

module.exports = router;
