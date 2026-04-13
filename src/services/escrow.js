const { server, networkPassphrase, StellarSdk } = require('../config/stellar');

/**
 * Lock funds: buyer sends XLM to escrow holding account.
 * @param {string} buyerSecret - Buyer's Stellar secret key
 * @param {string} escrowPublic - Escrow account public key
 * @param {string} amount - Amount in XLM
 * @param {string} memo - Deal ID as memo
 */
async function lockFunds(buyerSecret, escrowPublic, amount, memo) {
  // TODO: Build + sign + submit payment transaction
  // const buyerKeypair = StellarSdk.Keypair.fromSecret(buyerSecret);
  // const account = await server.loadAccount(buyerKeypair.publicKey());
  // const tx = new StellarSdk.TransactionBuilder(account, { fee, networkPassphrase })
  //   .addOperation(StellarSdk.Operation.payment({ destination: escrowPublic, asset: StellarSdk.Asset.native(), amount }))
  //   .addMemo(StellarSdk.Memo.text(memo))
  //   .setTimeout(30)
  //   .build();
  // tx.sign(buyerKeypair);
  // return server.submitTransaction(tx);
}

/**
 * Release funds: escrow account sends XLM to seller.
 */
async function releaseFunds(escrowSecret, sellerPublic, amount, memo) {
  // TODO: Same pattern as lockFunds but escrow → seller
}

/**
 * Refund: escrow account sends XLM back to buyer.
 */
async function refund(escrowSecret, buyerPublic, amount, memo) {
  // TODO: Same pattern as lockFunds but escrow → buyer
}

module.exports = { lockFunds, releaseFunds, refund };
