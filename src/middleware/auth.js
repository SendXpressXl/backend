const { randomBytes } = require('crypto');
const { StellarSdk }  = require('../config/stellar');
const supabase        = require('../config/supabase');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const SESSION_TTL_MS   = 24 * 60 * 60 * 1000;  // 24 hours

const sessions = new Map(); // token -> { wallet, expires }

/**
 * Persist a nonce for the wallet in the auth_challenges table.
 * Uses upsert so a repeated challenge request replaces the old one.
 */
async function issueChallenge(req, res) {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: 'wallet required', traceId: req.traceId ?? 'unknown' });

  const nonce      = randomBytes(32).toString('hex');
  const expiresAt  = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  const { error } = await supabase
    .from('auth_challenges')
    .upsert({ wallet_address: wallet, nonce, expires_at: expiresAt });

  if (error) return res.status(500).json({ error: 'Internal server error', traceId: req.traceId ?? 'unknown' });

  res.json({ nonce });
}

/**
 * Verify a signed nonce. Reads the challenge from Supabase (works across
 * restarts and multiple processes), checks expiry, validates Ed25519 signature,
 * then deletes the used challenge.
 */
async function verifySignature(req, res) {
  const { wallet, signature } = req.body;
  if (!wallet || !signature)
    return res.status(400).json({ error: 'wallet and signature required', traceId: req.traceId ?? 'unknown' });

  const { data, error } = await supabase
    .from('auth_challenges')
    .select('nonce, expires_at')
    .eq('wallet_address', wallet)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data)
    return res.status(401).json({ error: 'Challenge expired or not found', traceId: req.traceId ?? 'unknown' });

  try {
    const keypair   = StellarSdk.Keypair.fromPublicKey(wallet);
    const msgBuffer = Buffer.from(data.nonce);
    const sigBuffer = Buffer.from(signature, 'base64');
    const valid     = keypair.verify(msgBuffer, sigBuffer);

    if (!valid) return res.status(401).json({ error: 'Invalid signature', traceId: req.traceId ?? 'unknown' });

    // Consume the challenge so it cannot be replayed
    await supabase.from('auth_challenges').delete().eq('wallet_address', wallet);

    // Issue a session token the client uses as a Bearer credential
    const token   = randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_TTL_MS;
    sessions.set(token, { wallet, expires });

    res.json({ token, wallet });
  } catch {
    res.status(401).json({ error: 'Signature verification failed', traceId: req.traceId ?? 'unknown' });
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
