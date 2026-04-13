require('dotenv').config();
const express = require('express');
const cors = require('cors');

const usersRouter = require('./routes/users');
const postsRouter = require('./routes/posts');
const listingsRouter = require('./routes/listings');
const chatRouter = require('./routes/chat');
const dealsRouter = require('./routes/deals');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/deals', dealsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OyaShip API running on :${PORT}`));
