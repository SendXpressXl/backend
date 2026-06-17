const { randomUUID } = require('crypto');
const { logger } = require('../lib/logger');

/**
 * Attaches a traceId to every request and emits a structured log line on finish.
 */
function requestLogger(req, res, next) {
  const traceId = randomUUID();
  req.traceId   = traceId;
  const start   = Date.now();

  res.on('finish', () => {
    logger.info({
      traceId,
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      durationMs: Date.now() - start,
      wallet:     req.wallet ?? null,
    });
  });

  next();
}

module.exports = { requestLogger };
