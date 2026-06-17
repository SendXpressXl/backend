const { server, networkPassphrase, StellarSdk } = require('../config/stellar');

const BASE_FEE = '100';

async function buildAndSubmit(signerSecret, buildFn) {
  const keypair  = StellarSdk.Keypair.fromSecret(signerSecret);
  const account  = await server.loadAccount(keypair.publicKey());
  const tx = buildFn(account, keypair.publicKey());
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Build an unsigned escrow-lock transaction for the buyer to sign client-side.
 * Returns base64 XDR. The buyer secret key never reaches the server.
 */
async function buildLockTx(buyerPublic, escrowPublic, amount) {
  const account = await server.loadAccount(buyerPublic);
  const tx = new StellarSdk.TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(StellarSdk.Operation.payment({
      destination: escrowPublic,
      asset: StellarSdk.Asset.native(),
      amount: String(amount),
    }))
    .setTimeout(30)
    .build();
  return tx.toXDR('base64');
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
    new StellarSdk.TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(StellarSdk.Operation.payment({
        destination: sellerPublic,
        asset: StellarSdk.Asset.native(),
        amount: String(amount),
      }))
      .addMemo(StellarSdk.Memo.text(`release:${dealId}`))
      .setTimeout(30).build()
  );
}

async function refund(escrowSecret, buyerPublic, amount, dealId) {
  return buildAndSubmit(escrowSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(StellarSdk.Operation.payment({
        destination: buyerPublic,
        asset: StellarSdk.Asset.native(),
        amount: String(amount),
      }))
      .addMemo(StellarSdk.Memo.text(`refund:${dealId}`))
      .setTimeout(30).build()
  );
}

module.exports = { buildLockTx, submitSignedTx, releaseFunds, refund };
