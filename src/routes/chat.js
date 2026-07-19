const { Router } = require('express');
const supabase   = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  CreateConversationSchema,
  MessagesQuerySchema,
  CreateMessageSchema,
} = require('../validation/schemas');
const router = Router();

function resolveUser(wallet, res) {
  return supabase.from('users').select('id').eq('wallet', wallet).single().then(({ data }) => {
    if (!data) { res.status(403).json({ error: 'User profile not found — create your profile first' }); return null; }
    return data;
  });
}

// GET /api/chat/conversations — scoped to the authenticated wallet
router.get('/conversations', requireAuth, async (req, res) => {
  const user = await resolveUser(req.wallet, res);
  if (!user) return;

  const { data, error } = await supabase
    .from('conversations')
    .select('*, listings(title, image_url)')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('last_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat/conversations
router.post('/conversations', requireAuth, validate(CreateConversationSchema), async (req, res) => {
  const { listing_id } = req.body;

  const user = await resolveUser(req.wallet, res);
  if (!user) return;

  const { data: listing } = await supabase
    .from('listings').select('seller_id').eq('id', listing_id).single();
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const isSeller = listing.seller_id === user.id;
  const buyer_id  = isSeller ? (req.body.buyer_id || null) : user.id;
  const seller_id = isSeller ? user.id : listing.seller_id;

  if (!buyer_id)
    return res.status(400).json({ error: 'buyer_id is required when creating as seller' });

  if (buyer_id === user.id)
    return res.status(400).json({ error: 'Cannot create a conversation with yourself' });

  // Upsert instead of select-then-insert — two requests racing to create the
  // same (listing_id, buyer_id, seller_id) conversation used to both pass the
  // select check and insert duplicate rows. The unique constraint below makes
  // this atomic: the second writer hits ON CONFLICT DO UPDATE and gets the
  // same row back instead of a duplicate.
  //
  // Required Supabase migration:
  //   ALTER TABLE conversations
  //     ADD CONSTRAINT conversations_listing_buyer_seller_key
  //     UNIQUE (listing_id, buyer_id, seller_id);
  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      { listing_id, buyer_id, seller_id },
      { onConflict: 'listing_id,buyer_id,seller_id' },
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

// GET /api/chat/messages?conversationId=
router.get('/messages', requireAuth, validate(MessagesQuerySchema, 'query'), async (req, res) => {
  const { conversationId } = req.query;

  const user = await resolveUser(req.wallet, res);
  if (!user) return;

  const { data: conv } = await supabase
    .from('conversations').select('buyer_id, seller_id').eq('id', conversationId).single();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.buyer_id !== user.id && conv.seller_id !== user.id)
    return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('messages')
    .select('*, users(handle, avatar_url)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat/messages
router.post('/messages', requireAuth, validate(CreateMessageSchema), async (req, res) => {
  const { conversation_id, type, body, offer_amount } = req.body;

  const user = await resolveUser(req.wallet, res);
  if (!user) return;

  const { data: conv } = await supabase
    .from('conversations').select('buyer_id, seller_id').eq('id', conversation_id).single();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.buyer_id !== user.id && conv.seller_id !== user.id)
    return res.status(403).json({ error: 'Not a party to this conversation' });

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id, sender_id: user.id, type: type || 'text', body, offer_amount })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const lastMessagePreview = body.length > 200 ? body.substring(0, 200) : body;

  await supabase
    .from('conversations')
    .update({ last_message: lastMessagePreview, last_at: new Date().toISOString() })
    .eq('id', conversation_id);

  res.status(201).json(data);
});

module.exports = router;
