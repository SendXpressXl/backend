const { Router } = require('express');
const supabase   = require('../config/supabase');
const router = Router();

const PAGE_SIZE = 20;

// GET /api/posts?cursor=<created_at>&limit=<n>
router.get('/', async (req, res) => {
  const { cursor, limit } = req.query;
  const pageSize = Math.min(parseInt(limit) || PAGE_SIZE, 50);

  let query = supabase
    .from('posts')
    .select('*, users(handle, display_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(pageSize + 1); // fetch one extra to determine if there's a next page

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = data.length > pageSize;
  const posts   = hasMore ? data.slice(0, pageSize) : data;
  const nextCursor = hasMore ? posts[posts.length - 1].created_at : null;

  res.json({ posts, nextCursor, hasMore });
});

// POST /api/posts
router.post('/', async (req, res) => {
  const { user_id, text, image_url, tagged_listing_id } = req.body;
  if (!user_id || !text) return res.status(400).json({ error: 'user_id and text are required' });
  if (text.length > 2000) return res.status(400).json({ error: 'text exceeds 2000 character limit' });

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
