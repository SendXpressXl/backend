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
 * Buyer locks XLM into the escrow holding account.
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
          asset: StellarSdk.Asset.native(),
          amount: String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`deal:${dealId}`))
      .setTimeout(30)
      .build()
  );
}

/**
 * Escrow releases XLM to seller on deal confirmation.
 */
async function releaseFunds(escrowSecret, sellerPublic, amount, dealId) {
  return buildAndSubmit(escrowSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sellerPublic,
          asset: StellarSdk.Asset.native(),
          amount: String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`release:${dealId}`))
      .setTimeout(30)
      .build()
  );
}

/**
 * Escrow refunds XLM to buyer on cancellation or dispute resolution.
 */
async function refund(escrowSecret, buyerPublic, amount, dealId) {
  return buildAndSubmit(escrowSecret, (account) =>
    new StellarSdk.TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: buyerPublic,
          asset: StellarSdk.Asset.native(),
          amount: String(amount),
        })
      )
      .addMemo(StellarSdk.Memo.text(`refund:${dealId}`))
      .setTimeout(30)
      .build()
  );
}

module.exports = { lockFunds, releaseFunds, refund };
