const crypto = require('crypto');
const { logger } = require('../lib/logger');

const PROVIDERS = {
  transak: {
    apiKey:      process.env.TRANSAK_API_KEY || '',
    environment: process.env.TRANSAK_ENVIRONMENT === 'production' ? 'production' : 'staging',
    get baseUrl() {
      return this.environment === 'production'
        ? 'https://api.transak.com'
        : 'https://api-staging.transak.com';
    },
  },
};

/**
 * Create a Transak on-ramp session. Returns a hosted URL where the buyer
 * can complete their fiat payment and receive USDC on Stellar.
 *
 * @param {object} opts
 * @param {string} opts.dealId     - Our deal UUID
 * @param {number} opts.amountUsdc - Expected USDC amount
 * @param {string} opts.wallet     - Buyer's Stellar public key (destination for USDC)
 * @param {string} [opts.currency] - Fiat currency code (default USD)
 * @returns {Promise<{sessionId: string, url: string}>}
 */
async function createTransakSession({ dealId, amountUsdc, wallet, currency = 'USD' }) {
  const provider = PROVIDERS.transak;
  if (!provider.apiKey) {
    throw new Error('Transak API key not configured');
  }

  const params = new URLSearchParams({
    apiKey:            provider.apiKey,
    environment:       provider.environment,
    walletAddress:     wallet,
    blockchainNetwork: 'stellar',
    cryptoAmount:      String(amountUsdc),
    cryptoCurrency:    'USDC',
    fiatCurrency:      currency,
    partnerOrderId:    dealId,
    network:           'stellar',
  });

  const url = `${provider.baseUrl}/v2/session?${params.toString()}`;

  // Transak's hosted page flow — we return the URL for the client to redirect.
  // In a real integration you would call their REST API to create a session
  // and get back a sessionId + redirect URL. This simplified version builds
  // the URL directly for the MVP.
  const sessionId = crypto.randomUUID();

  logger.info({ dealId, wallet, amountUsdc, currency, sessionId }, 'Transak on-ramp session created');

  return { sessionId, url };
}

/**
 * Verify a Transak webhook signature. Transak signs payloads with HMAC-SHA512
 * using the webhook secret.
 *
 * @param {string} body      - Raw request body string
 * @param {string} signature - Value of the X-Transak-Signature header
 * @returns {boolean}
 */
function verifyTransakWebhook(body, signature) {
  const secret = process.env.TRANSAK_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('TRANSAK_WEBHOOK_SECRET not configured — rejecting webhook');
    return false;
  }

  const expected = crypto
    .createHmac('sha512', secret)
    .update(body)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch {
    return false;
  }
}

module.exports = { createTransakSession, verifyTransakWebhook, PROVIDERS };
