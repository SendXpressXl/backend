const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'sendxpress-backend', env: process.env.NODE_ENV },
});

module.exports = { logger };
