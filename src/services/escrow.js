const { server, networkPassphrase, StellarSdk } = require('../config/stellar');
const { logger } = require('../lib/logger');

const BASE_FEE = '100';

/**
 * Returns true for transient Stellar errors that are safe to retry.
 */
function isTransientError(err) {
  const txCode = err?.response?.data?.extras?.result_codes?.transaction;
  return txCode === 'tx_bad_seq' || err.code === 'ECONNRESET';
}

/**
 * Build and submit a Stellar transaction, retrying on transient errors
 * with exponential backoff.
 *
 * @param {string}   signerSecret - Secret key of the signing account
 * @param {Function} buildFn      - Receives (account, publicKey) and returns a built Transaction
 * @param {object}   [opts]
 * @param {number}   [opts.maxAttempts=3]
 */
async function buildAndSubmit(signerSecret, buildFn, { maxAttempts = 3 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
      const account = await server.loadAccount(keypair.publicKey());
      const tx      = buildFn(account, keypair.publicKey());
      tx.sign(keypair);
      const result  = await server.submitTransaction(tx);
      return result.hash;
    } catch (err) {
      if (!isTransientError(err) || attempt === maxAttempts) throw err;

      const backoffMs = Math.min(200 * 2 ** attempt, 5000);
      logger.warn(
        { attempt, backoffMs, err: err.message },
        'Stellar submission failed, retrying'
      );
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Build an unsigned escrow-lock transaction for the buyer to sign client-side.
 * Returns base64 XDR. The buyer secret key never reaches the server.
 */
async function lockFunds(buyerSecret, escrowPublic, amount, dealId) {
  return buildAndSubmit(buyerSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: escrowPublic,
          asset:       StellarSdk.Asset.native(),
          amount:      String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`deal:${dealId}`))
      .setTimeout(30)
      .build()
  );
}

/**
 * Submit a pre-signed XDR envelope received from the buyer.
 * Uses StellarSdk.Transaction constructor (SDK v10+ API).
 */
async function submitSignedTx(signedXdr) {
  const tx = new StellarSdk.Transaction(signedXdr, networkPassphrase);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

async function releaseFunds(escrowSecret, sellerPublic, amount, dealId) {
  return buildAndSubmit(escrowSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sellerPublic,
          asset:       StellarSdk.Asset.native(),
          amount:      String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`release:${dealId}`))
      .setTimeout(30).build()
  );
}

async function refund(escrowSecret, buyerPublic, amount, dealId) {
  return buildAndSubmit(escrowSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: buyerPublic,
          asset:       StellarSdk.Asset.native(),
          amount:      String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`refund:${dealId}`))
      .setTimeout(30).build()
  );
}

module.exports = { buildLockTx, submitSignedTx, releaseFunds, refund };
