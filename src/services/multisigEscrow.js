const { logger } = require('../lib/logger');

const DEFAULT_HIGH_VALUE_THRESHOLD = 5000;

function getHighValueThreshold() {
  const envVal = process.env.ESCROW_MULTISIG_THRESHOLD;
  if (envVal && !isNaN(Number(envVal))) {
    return Number(envVal);
  }
  return DEFAULT_HIGH_VALUE_THRESHOLD;
}

const DEFAULT_SIGNERS = {
  platform: process.env.MULTISIG_SIGNER_PLATFORM || process.env.ESCROW_PUBLIC_KEY || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  arbitrator: process.env.MULTISIG_SIGNER_ARBITRATOR || 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMTXDRXDYGY7ZB',
  dao: process.env.MULTISIG_SIGNER_DAO || 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
};

const MULTISIG_ESCROW_PUBLIC = process.env.MULTISIG_ESCROW_PUBLIC_KEY || 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const STANDARD_ESCROW_PUBLIC = process.env.ESCROW_PUBLIC_KEY || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/**
 * Determine deal tier based on deal amount.
 * @param {number|string} amount
 * @returns {'standard' | 'high_value'}
 */
function getDealTier(amount) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount)) return 'standard';
  return numericAmount >= getHighValueThreshold() ? 'high_value' : 'standard';
}

/**
 * Get approved escrow destination address based on deal tier.
 * @param {'standard' | 'high_value'} tier
 * @returns {string}
 */
function getEscrowDestination(tier) {
  return tier === 'high_value' ? MULTISIG_ESCROW_PUBLIC : STANDARD_ESCROW_PUBLIC;
}

/**
 * Returns list of approved signers for a tier.
 * @param {'standard' | 'high_value'} tier
 * @returns {Array<{ role: string, address: string, weight: number }>}
 */
function getApprovedSigners(tier) {
  if (tier === 'high_value') {
    return [
      { role: 'platform', address: DEFAULT_SIGNERS.platform, weight: 1 },
      { role: 'arbitrator', address: DEFAULT_SIGNERS.arbitrator, weight: 1 },
      { role: 'dao', address: DEFAULT_SIGNERS.dao, weight: 1 },
    ];
  }
  return [
    { role: 'single_arbiter', address: STANDARD_ESCROW_PUBLIC, weight: 1 },
  ];
}

/**
 * Required vote threshold for dispute resolution.
 * @param {'standard' | 'high_value'} tier
 * @returns {number}
 */
function getRequiredThreshold(tier) {
  return tier === 'high_value' ? 2 : 1;
}

/**
 * Check if an address is an approved signer for the given tier.
 * @param {string} address
 * @param {'standard' | 'high_value'} tier
 * @returns {{ isApproved: boolean, role?: string }}
 */
function checkSignerApproval(address, tier) {
  const signers = getApprovedSigners(tier);
  const found = signers.find((s) => s.address === address);
  if (found) {
    return { isApproved: true, role: found.role };
  }
  return { isApproved: false };
}

/**
 * Evaluates whether submitted dispute votes meet the required majority threshold.
 * @param {Array<{ signer: string, role: string, vote: string }>} votes
 * @param {'standard' | 'high_value'} tier
 * @returns {{ resolved: boolean, winningVote?: string, voteCounts: Record<string, number>, required: number }}
 */
function evaluateDisputeResolution(votes, tier) {
  const required = getRequiredThreshold(tier);
  const voteCounts = {
    release_seller: 0,
    refund_buyer: 0,
  };

  for (const v of votes) {
    if (v.vote && voteCounts[v.vote] !== undefined) {
      voteCounts[v.vote] += 1;
    }
  }

  if (voteCounts.release_seller >= required) {
    return { resolved: true, winningVote: 'release_seller', voteCounts, required };
  }
  if (voteCounts.refund_buyer >= required) {
    return { resolved: true, winningVote: 'refund_buyer', voteCounts, required };
  }

  return { resolved: false, voteCounts, required };
}

module.exports = {
  getHighValueThreshold,
  getDealTier,
  getEscrowDestination,
  getApprovedSigners,
  getRequiredThreshold,
  checkSignerApproval,
  evaluateDisputeResolution,
  DEFAULT_SIGNERS,
  MULTISIG_ESCROW_PUBLIC,
  STANDARD_ESCROW_PUBLIC,
};
