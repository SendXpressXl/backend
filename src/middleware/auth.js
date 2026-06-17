const { StellarSdk } = require('../config/stellar');
const crypto = require('crypto');

const challenges = new Map();
const sessions   = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Evict expired sessions every minute to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expires) sessions.delete(token);
  }
}, 60_000);

// Evict expired challenges to prevent unbounded growth under wallet-flood attacks
setInterval(() => {
  const now = Date.now();
  for (const [wallet, entry] of challenges) {
    if (now > entry.expires) challenges.delete(wallet);
  }
}, 60_000);

/**
 * GET /api/auth/challenge?wallet=
 */
function issueChallenge(req, res) {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const nonce = `sendxpress:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  challenges.set(wallet, { nonce, expires: Date.now() + 60_000 });
  res.json({ nonce });
}

/**
 * POST /api/auth/verify — verify signed nonce, return opaque session token
 */
function verifySignature(req, res) {
  const { wallet, signature } = req.body;
  if (!wallet || !signature) return res.status(400).json({ error: 'wallet and signature required' });

  const entry = challenges.get(wallet);
  if (!entry || Date.now() > entry.expires)
    return res.status(401).json({ error: 'Challenge expired or not found' });

  try {
    const keypair   = StellarSdk.Keypair.fromPublicKey(wallet);
    const msgBuffer = Buffer.from(entry.nonce);
    const sigBuffer = Buffer.from(signature, 'base64');
    const valid     = keypair.verify(msgBuffer, sigBuffer);

    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    challenges.delete(wallet);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { wallet, expires: Date.now() + SESSION_TTL_MS });
    res.json({ wallet, token, verified: true });
  } catch {
    res.status(401).json({ error: 'Signature verification failed' });
  }
}

/**
 * Middleware: require a valid Bearer session token on protected routes.
 * Sets req.wallet to the verified wallet address.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });

  const token   = authHeader.slice(7);
  const session = sessions.get(token);

  if (!session || Date.now() > session.expires) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  req.wallet = session.wallet;
  next();
}

/**
 * POST /api/auth/logout — immediately revoke the caller's session token
 */
function logout(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessions.delete(authHeader.slice(7));
  }
  res.json({ success: true });
}

module.exports = { issueChallenge, verifySignature, requireAuth, logout };
