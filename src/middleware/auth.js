/**
 * Verify Stellar wallet signature for authenticated requests.
 * TODO: Implement challenge-response auth:
 * 1. Server issues a random challenge
 * 2. Client signs with Stellar secret key
 * 3. Server verifies signature against public key
 */
function requireAuth(req, res, next) {
  const wallet = req.headers['x-wallet-address'];
  if (!wallet) return res.status(401).json({ error: 'Missing wallet address' });
  req.wallet = wallet;
  next();
}

module.exports = { requireAuth };
