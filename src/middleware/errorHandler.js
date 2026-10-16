const { logger } = require('../lib/logger');
const { redactSecretKeys } = require('./rejectSecretKeys');

/**
 * Global Express error handler — must be registered last.
 * Never exposes internal error details; always returns { error, traceId }.
 * Secret-key-shaped substrings are redacted so they cannot leak via logs
 * or error responses (issue #32).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const traceId = req.traceId ?? 'unknown';
  const safeMessage = redactSecretKeys(err.message);

  logger.error(
    { traceId, err: { message: safeMessage, stack: redactSecretKeys(err.stack) }, path: req.path, method: req.method },
    'Unhandled error'
  );

  const statusCode = err.statusCode ?? 500;
  const message    = statusCode === 500 ? 'Internal server error' : safeMessage;

  res.status(statusCode).json({ error: message, traceId });
}

module.exports = { errorHandler };
