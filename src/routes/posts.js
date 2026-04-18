const { Router } = require('express');
const supabase   = require('../config/supabase');
const router = Router();

// GET /api/posts
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('posts')
    .select('*, users(handle, display_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/posts
router.post('/', async (req, res) => {
  const { user_id, text, image_url, tagged_listing_id } = req.body;
  if (!user_id || !text) return res.status(400).json({ error: 'user_id and text are required' });

  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id, text, image_url, tagged_listing_id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/posts/:id/like
router.post('/:id/like', async (req, res) => {
  const { id } = req.params;

  const { data: post, error: fetchErr } = await supabase
    .from('posts').select('likes_count').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Post not found' });

  const { data, error } = await supabase
    .from('posts')
    .update({ likes_count: (post.likes_count || 0) + 1 })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ likes_count: data.likes_count });
});

module.exports = router;
