const { Router } = require('express');
const { escape } = require('html-escaper');
const supabase   = require('../config/supabase');
const { validate } = require('../middleware/validate');
const { IdParamSchema, PostsQuerySchema, CreatePostSchema } = require('../validation/schemas');
const router = Router();

// GET /api/posts?cursor=<created_at>&limit=<n>
router.get('/', validate(PostsQuerySchema, 'query'), async (req, res) => {
  const { cursor, limit } = req.query; // validated: cursor is ISO-8601, limit ∈ [1, 50]
  const pageSize = limit;

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
router.post('/', validate(CreatePostSchema), async (req, res) => {
  const { user_id, text, image_url, tagged_listing_id } = req.body;

  // HTML-encode user-supplied text before storage to neutralise stored XSS.
  // ASSUMPTION: the rendering layer is an HTML/browser context. This trades a
  // little fidelity for safety — non-HTML consumers (mobile, plain-text email,
  // PDF) receive encoded entities, and re-encoding elsewhere risks double
  // encoding. The cleaner long-term approach is encode-on-output plus a CSP
  // header; this stays here so the backend is safe by default regardless of
  // what any single client does.
  const safeText = escape(text);

  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id, text: safeText, image_url, tagged_listing_id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/posts/:id/like
router.post('/:id/like', validate(IdParamSchema, 'params'), async (req, res) => {
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
