const StellarSdk = require('@stellar/stellar-sdk');

const server = new StellarSdk.Horizon.Server(
  process.env.STELLAR_HORIZON || 'https://horizon-testnet.stellar.org'
);

const networkPassphrase =
  process.env.STELLAR_NETWORK === 'public'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

module.exports = { server, networkPassphrase, StellarSdk };
