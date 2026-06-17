const { Router } = require('express');
const supabase   = require('../config/supabase');
const { validate } = require('../middleware/validate');
const {
  ConversationsQuerySchema,
  CreateConversationSchema,
  MessagesQuerySchema,
  CreateMessageSchema,
} = require('../validation/schemas');
const router = Router();

// GET /api/chat/conversations?userId=
router.get('/conversations', validate(ConversationsQuerySchema, 'query'), async (req, res) => {
  const { userId } = req.query;

  const { data, error } = await supabase
    .from('conversations')
    .select('*, listings(title, image_url)')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('last_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat/conversations — create or find existing
router.post('/conversations', validate(CreateConversationSchema), async (req, res) => {
  const { listing_id, buyer_id, seller_id } = req.body;

  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('listing_id', listing_id)
    .eq('buyer_id', buyer_id)
    .single();
  if (existing) return res.json(existing);

  const { data, error } = await supabase
    .from('conversations')
    .insert({ listing_id, buyer_id, seller_id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/chat/messages?conversationId=
router.get('/messages', validate(MessagesQuerySchema, 'query'), async (req, res) => {
  const { conversationId } = req.query;

  const { data, error } = await supabase
    .from('messages')
    .select('*, users(handle, avatar_url)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat/messages
router.post('/messages', validate(CreateMessageSchema), async (req, res) => {
  const { conversation_id, sender_id, type, body, offer_amount } = req.body;

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id, sender_id, type: type || 'text', body, offer_amount })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('conversations')
    .update({ last_message: body, last_at: new Date().toISOString() })
    .eq('id', conversation_id);

  res.status(201).json(data);
});

module.exports = router;
