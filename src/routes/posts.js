const { Router } = require('express');
const { escape } = require('html-escaper');
const supabase   = require('../config/supabase');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { IdParamSchema, PostsQuerySchema } = require('../validation/schemas');
const router = Router();

// GET /api/posts
// optionalAuth so anonymous callers still get the feed, but a signed-in
// caller also gets `liked` on each post, based on their own post_likes rows.
router.get('/', optionalAuth, validate(PostsQuerySchema, 'query'), async (req, res) => {
  const { cursor, limit } = req.query;
  const pageSize = limit;

  let query = supabase
    .from('posts')
    .select('*, users(handle, display_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = data.length > pageSize;
  const posts   = hasMore ? data.slice(0, pageSize) : data;
  const nextCursor = hasMore ? posts[posts.length - 1].created_at : null;

  let likedIds = new Set();
  if (req.wallet && posts.length > 0) {
    const { data: user } = await supabase
      .from('users').select('id').eq('wallet', req.wallet).single();
    if (user) {
      const { data: likes } = await supabase
        .from('post_likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', posts.map((p) => p.id));
      likedIds = new Set((likes ?? []).map((l) => l.post_id));
    }
  }

  res.json({
    posts: posts.map((p) => ({ ...p, liked: likedIds.has(p.id) })),
    nextCursor,
    hasMore,
  });
});

// POST /api/posts
router.post('/', requireAuth, async (req, res) => {
  const { text, image_url, tagged_listing_id } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 2000) return res.status(400).json({ error: 'text exceeds 2000 character limit' });

  // Derive user_id from the authenticated wallet — any user_id in the body is ignored
  const { data: user } = await supabase
    .from('users').select('id').eq('wallet', req.wallet).single();
  if (!user) return res.status(403).json({ error: 'User profile not found — create your profile first' });

  // HTML-encode user-supplied text to neutralise stored XSS
  const safeText = escape(text);

  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id: user.id, text: safeText, image_url, tagged_listing_id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// POST /api/posts/:id/like
// Toggles a like for the authenticated user on this post: creates a
// post_likes row if one doesn't exist yet, removes it if it does. The
// insert/delete and the likes_count update happen together in the
// toggle_post_like() DB function, so there's no read-modify-write step for
// concurrent requests to race against. See sql/post_likes.sql.
router.post('/:id/like', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { id } = req.params;

  // Verify the post exists before attempting the toggle
  const { error: fetchErr } = await supabase
    .from('posts').select('id').eq('id', id).single();
  if (fetchErr) return res.status(404).json({ error: 'Post not found' });

  const { data: user } = await supabase
    .from('users').select('id').eq('wallet', req.wallet).single();
  if (!user) return res.status(403).json({ error: 'User profile not found — create your profile first' });

  const { data, error } = await supabase
    .rpc('toggle_post_like', { p_post_id: id, p_user_id: user.id })
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ liked: data.liked, likes_count: data.likes_count });
});

module.exports = router;
