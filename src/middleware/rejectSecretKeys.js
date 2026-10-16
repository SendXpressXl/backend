/**
 * Defense-in-depth for issue #32: the escrow lock flow is client-signed XDR,
 * but an outdated or malicious client can still POST a Stellar secret key.
 * Zod's object schemas strip unknown keys, which would silently drop the
 * secret and leave the client thinking it was used — and any request-body
 * logging elsewhere would capture it.
 *
 * Reject the request outright when a secret-key-shaped value is present.
 */

// Stellar secret keys are base32, S-prefixed, 56 chars total.
const SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/;

function containsSecretKey(value) {
  if (typeof value === 'string') return SECRET_KEY_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsSecretKey);
  }
  return false;
}

/**
 * Express middleware: 400 when req.body (or req.query) carries a value that
 * looks like a Stellar secret key. Must run before route handlers.
 */
function rejectSecretKeys(req, res, next) {
  if (containsSecretKey(req.body) || containsSecretKey(req.query)) {
    return res.status(400).json({
      error:
        'Stellar secret keys must never be sent to the server. Sign the lock transaction client-side and submit the signed XDR.',
      traceId: req.traceId ?? 'unknown',
    });
  }
  next();
}

/**
 * Replace any Stellar secret-key-shaped substring so it cannot reach logs
 * or error responses.
 */
function redactSecretKeys(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SECRET_KEY_PATTERN, '[REDACTED_STELLAR_SECRET]');
}

module.exports = { rejectSecretKeys, redactSecretKeys, SECRET_KEY_PATTERN };
