const { logger } = require('../lib/logger');

/**
 * Global Express error handler — must be registered last.
 * Never exposes internal error details; always returns { error, traceId }.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const traceId = req.traceId ?? 'unknown';

  logger.error({ traceId, err, path: req.path, method: req.method }, 'Unhandled error');

  const statusCode = err.statusCode ?? 500;
  const message    = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({ error: message, traceId });
}

module.exports = { errorHandler };
