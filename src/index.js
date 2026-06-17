require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { logger }        = require('./lib/logger');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler }  = require('./middleware/errorHandler');
const { rateLimit }     = require('./middleware/rateLimit');
const { issueChallenge, verifySignature } = require('./middleware/auth');

const healthRouter   = require('./routes/health');
const usersRouter    = require('./routes/users');
const postsRouter    = require('./routes/posts');
const listingsRouter = require('./routes/listings');
const chatRouter     = require('./routes/chat');
const dealsRouter    = require('./routes/deals');

// ── Process-level guards ────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

// ── App setup ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(rateLimit(100, 60_000));

// ── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/health', healthRouter);

app.get('/api/auth/challenge', issueChallenge);
app.post('/api/auth/verify',   verifySignature);

app.use('/api/users',    usersRouter);
app.use('/api/posts',    postsRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/chat',     chatRouter);
app.use('/api/deals',    dealsRouter);

// ── Global error handler (must be last) ─────────────────────────────────────

app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info({ port: PORT }, 'SendXpress API running'));

module.exports = app;
