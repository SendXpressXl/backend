require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const usersRouter    = require('./routes/users');
const postsRouter    = require('./routes/posts');
const listingsRouter = require('./routes/listings');
const chatRouter     = require('./routes/chat');
const dealsRouter    = require('./routes/deals');
const { issueChallenge, verifySignature, requireAuth, logout } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimit(100, 60_000));

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/auth/challenge', issueChallenge);
app.post('/api/auth/verify',   verifySignature);
app.post('/api/auth/logout',   requireAuth, logout);

app.use('/api/users',    usersRouter);
app.use('/api/posts',    postsRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/chat',     chatRouter);
app.use('/api/deals',    dealsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SendXpress API running on :${PORT}`));

module.exports = app;
