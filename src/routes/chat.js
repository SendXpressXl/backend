const { Router } = require('express');
const supabase = require('../config/supabase');
const router = Router();

// GET /api/chat/conversations?userId=
router.get('/conversations', async (req, res) => {
  // TODO: fetch conversations for user
  res.json([]);
});

// GET /api/chat/messages?conversationId=
router.get('/messages', async (req, res) => {
  // TODO: fetch messages for conversation
  res.json([]);
});

// POST /api/chat/messages
router.post('/messages', async (req, res) => {
  // TODO: send message + update conversation.last_message
  res.json({ todo: true });
});

// POST /api/chat/conversations
router.post('/conversations', async (req, res) => {
  // TODO: create or find conversation
  res.json({ todo: true });
});

module.exports = router;
