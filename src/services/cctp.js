const {
  CCTP_SUPPORTED_CHAINS,
  CCTP_ATTESTATION_BASE,
  CCTP_POLL_INTERVAL_MS,
  CCTP_MAX_POLL_ATTEMPTS,
} = require('../config/cctp');
const { logger } = require('../lib/logger');

/**
 * Fetch the attestation for a CCTP burn transaction from Circle's Iris API.
 * The attestation is a signed message that proves the burn happened on the
 * source chain and authorizes the mint on the destination chain.
 *
 * @param {string} txHash   - The burn transaction hash on the source chain
 * @param {number} sourceDomain - CCTP domain ID of the source chain
 * @returns {Promise<{status: string, attestation?: string, message?: string}>}
 */
async function fetchAttestation(txHash, sourceDomain) {
  const url = `${CCTP_ATTESTATION_BASE}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Attestation API returned ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Poll for an attestation until it's complete or we hit the max attempts.
 * CCTP attestations typically resolve in 1-5 minutes on testnet.
 *
 * @param {string} txHash
 * @param {number} sourceDomain
 * @returns {Promise<{attestation: string, message: string}>}
 */
async function pollForAttestation(txHash, sourceDomain) {
  for (let attempt = 1; attempt <= CCTP_MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const result = await fetchAttestation(txHash, sourceDomain);

      if (result.status === 'complete' && result.messages?.[0]) {
        const msg = result.messages[0];
        if (msg.attestation && msg.attestation !== 'PENDING') {
          logger.info({ txHash, attempt }, 'CCTP attestation received');
          return { attestation: msg.attestation, message: msg.message };
        }
      }
    } catch (err) {
      logger.warn({ txHash, attempt, err: err.message }, 'Attestation poll failed, retrying');
    }

    await new Promise(r => setTimeout(r, CCTP_POLL_INTERVAL_MS));
  }

  throw new Error('Attestation polling timed out after max attempts');
}

/**
 * Look up a supported chain by name or chain ID.
 *
 * @param {string|number} chain - Chain name (e.g. "ethereum") or chain ID
 * @returns {object|null}
 */
function getChainConfig(chain) {
  if (typeof chain === 'number') {
    return Object.values(CCTP_SUPPORTED_CHAINS).find(c => c.chainId === chain) || null;
  }
  return CCTP_SUPPORTED_CHAINS[chain.toLowerCase()] || null;
}

/**
 * Validate that a burn transaction hash looks legitimate.
 * This is a basic format check — the actual verification happens
 * when we fetch the attestation from Circle.
 *
 * @param {string} txHash
 * @returns {boolean}
 */
function isValidTxHash(txHash) {
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

/**
 * Get all supported chains as a list for the API response.
 */
function listSupportedChains() {
  return Object.entries(CCTP_SUPPORTED_CHAINS).map(([key, cfg]) => ({
    key,
    name: cfg.name,
    chainId: cfg.chainId,
    domain: cfg.domain,
    usdcAddress: cfg.usdcAddress,
  }));
}

module.exports = {
  fetchAttestation,
  pollForAttestation,
  getChainConfig,
  isValidTxHash,
  listSupportedChains,
};
