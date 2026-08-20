/**
 * Circle CCTP (Cross-Chain Transfer Protocol) configuration.
 *
 * CCTP v2 lets users burn USDC on a source EVM chain and mint it natively
 * on Stellar. The backend listens for burn events, fetches attestations
 * from Circle's API, and credits the user's balance once confirmed.
 *
 * Supported chains: Ethereum, Arbitrum, Base, Avalanche (testnet first).
 */

const CCTP_SUPPORTED_CHAINS = {
  ethereum: {
    chainId: 11155111, // Sepolia
    domain: 0,
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e15631fA6d7',
    name: 'Ethereum Sepolia',
  },
  arbitrum: {
    chainId: 421614, // Arbitrum Sepolia
    domain: 3,
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessenger: '0xAd5230569533477f3744a17F6e82D5Ef0e7286D5',
    name: 'Arbitrum Sepolia',
  },
  base: {
    chainId: 84532, // Base Sepolia
    domain: 6,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e15631fA6d7',
    name: 'Base Sepolia',
  },
  avalanche: {
    chainId: 43113, // Fuji
    domain: 1,
    usdcAddress: '0x5425890298aed601595a70AB815c96711a31Bc65',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e15631fA6d7',
    name: 'Avalanche Fuji',
  },
};

const CCTP_ATTESTATION_BASE = process.env.CCTP_ATTESTATION_URL
  || 'https://iris-api-sandbox.circle.com';

const CCTP_POLL_INTERVAL_MS = 5000;   // 5 seconds
const CCTP_MAX_POLL_ATTEMPTS = 120;    // 10 minutes total

module.exports = {
  CCTP_SUPPORTED_CHAINS,
  CCTP_ATTESTATION_BASE,
  CCTP_POLL_INTERVAL_MS,
  CCTP_MAX_POLL_ATTEMPTS,
};
