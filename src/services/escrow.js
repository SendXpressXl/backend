const crypto = require('crypto');
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
 * Stellar's MEMO_TEXT is capped at 28 bytes, too short for a "deal:<uuid>"
 * style memo (a UUID alone is 36 bytes). Hash the deal id into a fixed
 * 32-byte MEMO_HASH instead — still a verifiable, deterministic link back to
 * the deal, it just isn't human-readable in an explorer.
 */
function dealMemo(dealId) {
  return StellarSdk.Memo.hash(crypto.createHash('sha256').update(dealId).digest());
}

/**
 * Build and submit a Stellar transaction, retrying on transient errors
 * with exponential backoff. server.submitTransaction() already blocks until
 * the transaction is included in a ledger (or fails) — its response carries
 * the confirmed ledger number, so there's no separate poll-for-confirmation
 * step needed on the success path.
 *
 * @param {string}   signerSecret - Secret key of the signing account
 * @param {Function} buildFn      - Receives (account, publicKey) and returns a built Transaction
 * @param {object}   [opts]
 * @param {number}   [opts.maxAttempts=3]
 * @returns {Promise<{hash: string, ledger: number}>}
 */
async function buildAndSubmit(signerSecret, buildFn, { maxAttempts = 3 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(signerSecret);
      const account = await server.loadAccount(keypair.publicKey());
      const tx      = buildFn(account, keypair.publicKey());
      tx.sign(keypair);
      const result  = await server.submitTransaction(tx);
      if (!result.successful) throw new Error(`Transaction ${result.hash} was not successful`);
      return { hash: result.hash, ledger: result.ledger };
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
async function buildLockTx(buyerPublic, escrowPublic, amount, dealId) {
  const account = await server.loadAccount(buyerPublic);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: escrowPublic,
        asset: StellarSdk.Asset.native(),
        amount: String(amount),
      })
    )
    .addMemo(dealMemo(dealId))
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

/**
 * Submit a pre-signed XDR envelope received from the buyer.
 * Uses StellarSdk.Transaction constructor (SDK v10+ API).
 *
 * @returns {Promise<{hash: string, ledger: number}>}
 */
async function submitSignedTx(signedXdr) {
  const tx = new StellarSdk.Transaction(signedXdr, networkPassphrase);
  const result = await server.submitTransaction(tx);
  if (!result.successful) throw new Error(`Transaction ${result.hash} was not successful`);
  return { hash: result.hash, ledger: result.ledger };
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
      .addMemo(dealMemo(dealId))
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
      .addMemo(dealMemo(dealId))
      .setTimeout(30).build()
  );
}

/**
 * Re-fetch a submitted transaction from Horizon and confirm the payment it
 * contains actually matches what the deal expects: destination, amount, and
 * the deal-id memo. A stored tx_hash is only as trustworthy as the moment it
 * was written — this lets a deal be checked against the chain at any time.
 *
 * @param {string} hash
 * @param {object} expected
 * @param {string} expected.destination
 * @param {string|number} expected.amount
 * @param {string} expected.dealId
 * @returns {Promise<{verified: boolean, reason?: string, ledger?: number}>}
 */
async function verifyTransaction(hash, { destination, amount, dealId }) {
  let record;
  try {
    record = await server.transactions().transaction(hash).call();
  } catch (err) {
    return { verified: false, reason: 'transaction not found on-chain' };
  }

  if (!record.successful) {
    return { verified: false, reason: 'transaction did not succeed on-chain', ledger: record.ledger };
  }

  if (record.memo_type !== 'hash' || record.memo !== dealMemo(dealId).value.toString('base64')) {
    return { verified: false, reason: 'memo does not match this deal', ledger: record.ledger };
  }

  const ops = await record.operations();
  const payment = ops.records.find((op) => op.type === 'payment');
  if (!payment) {
    return { verified: false, reason: 'no payment operation in transaction', ledger: record.ledger };
  }
  if (payment.to !== destination) {
    return { verified: false, reason: 'destination does not match', ledger: record.ledger };
  }
  if (payment.amount !== String(amount)) {
    return { verified: false, reason: 'amount does not match', ledger: record.ledger };
  }

  return { verified: true, ledger: record.ledger };
}

module.exports = { buildLockTx, submitSignedTx, releaseFunds, refund, verifyTransaction, dealMemo };
