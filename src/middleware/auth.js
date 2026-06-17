const { randomBytes } = require('crypto');
const { StellarSdk }  = require('../config/stellar');
const supabase        = require('../config/supabase');

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Persist a nonce for the wallet in the auth_challenges table.
 * Uses upsert so a repeated challenge request replaces the old one.
 */
async function issueChallenge(req, res) {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const nonce      = randomBytes(32).toString('hex');
  const expiresAt  = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  const { error } = await supabase
    .from('auth_challenges')
    .upsert({ wallet_address: wallet, nonce, expires_at: expiresAt });

  if (error) return res.status(500).json({ error: 'Internal server error' });

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
    return res.status(400).json({ error: 'wallet and signature required' });

  const { data, error } = await supabase
    .from('auth_challenges')
    .select('nonce, expires_at')
    .eq('wallet_address', wallet)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data)
    return res.status(401).json({ error: 'Challenge expired or not found' });

  try {
    const keypair   = StellarSdk.Keypair.fromPublicKey(wallet);
    const msgBuffer = Buffer.from(data.nonce);
    const sigBuffer = Buffer.from(signature, 'base64');
    const valid     = keypair.verify(msgBuffer, sigBuffer);

    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    // Consume the challenge so it cannot be replayed
    await supabase.from('auth_challenges').delete().eq('wallet_address', wallet);

    res.json({ wallet, verified: true });
  } catch {
    res.status(401).json({ error: 'Signature verification failed' });
  }
}

/**
 * Middleware: require x-wallet-address header on protected routes.
 */
function requireAuth(req, res, next) {
  const wallet = req.headers['x-wallet-address'];
  if (!wallet) return res.status(401).json({ error: 'Missing x-wallet-address header' });
  try {
    StellarSdk.Keypair.fromPublicKey(wallet);
  } catch {
    return res.status(401).json({ error: 'Invalid wallet address' });
  }
  req.wallet = wallet;
  next();
}

module.exports = { issueChallenge, verifySignature, requireAuth };
