const supabase = require('../config/supabase');
const { server, StellarSdk, networkPassphrase } = require('../config/stellar');
const { pollForAttestation, getChainConfig, isValidTxHash } = require('./cctp');
const { canTransition } = require('./dealStateMachine');
const { logger } = require('../lib/logger');

const ESCROW_SECRET = process.env.ESCROW_SECRET_KEY;
const ESCROW_PUBLIC = process.env.ESCROW_PUBLIC_KEY;

// Custom error classes for clean error handling in routes
class UnsupportedChainError extends Error {
  constructor(chain) { super(`Unsupported chain: ${chain}`); this.code = 'UNSUPPORTED_CHAIN'; }
}
class InvalidTxHashError extends Error {
  constructor() { super('Invalid burn transaction hash'); this.code = 'INVALID_TX_HASH'; }
}
class DuplicateBurnHashError extends Error {
  constructor(depositId) { super(`Burn hash already used in deposit ${depositId}`); this.code = 'DUPLICATE_BURN_HASH'; }
}
class DealNotFoundError extends Error {
  constructor() { super('Deal not found'); this.code = 'DEAL_NOT_FOUND'; }
}
class NotBuyerError extends Error {
  constructor() { super('Not the buyer'); this.code = 'NOT_BUYER'; }
}
class InvalidDealStatusError extends Error {
  constructor(status) { super(`Deal is not in a lockable status, currently: ${status}`); this.code = 'INVALID_DEAL_STATUS'; }
}

/**
 * Process a cross-chain USDC deposit.
 *
 * Flow:
 * 1. Buyer submits a burn tx hash from an EVM chain
 * 2. We poll Circle's attestation API until the burn is confirmed
 * 3. We credit the user's USDC balance on Stellar
 * 4. Lock the funds into escrow for the deal
 *
 * This runs asynchronously — the API returns immediately with a
 * pending status and the client polls for completion.
 *
 * @param {object} params
 * @param {string} params.dealId
 * @param {string} params.buyerWallet
 * @param {string} params.burnTxHash
 * @param {string} params.sourceChain
 * @param {number} params.amount
 * @returns {Promise<{depositId: string, status: string}>}
 */
async function initiateCrossChainDeposit({ dealId, buyerWallet, burnTxHash, sourceChain, amount }) {
  const chain = getChainConfig(sourceChain);
  if (!chain) throw new UnsupportedChainError(sourceChain);
  if (!isValidTxHash(burnTxHash)) throw new InvalidTxHashError();

  // Check if this burn hash was already used
  const { data: existing } = await supabase
    .from('cross_chain_deposits')
    .select('id, status')
    .eq('burn_tx_hash', burnTxHash)
    .maybeSingle();
  if (existing) throw new DuplicateBurnHashError(existing.id);

  // Verify the deal exists and belongs to this buyer
  const { data: deal, error: fetchErr } = await supabase
    .from('deals').select('*').eq('id', dealId).single();
  if (fetchErr) throw new DealNotFoundError();
  if (deal.buyer !== buyerWallet) throw new NotBuyerError();
  if (!canTransition(deal.status, 'locking')) throw new InvalidDealStatusError(deal.status);

  // Create a pending deposit record
  const { data: deposit, error: insertErr } = await supabase
    .from('cross_chain_deposits')
    .insert({
      deal_id: dealId,
      buyer_wallet: buyerWallet,
      burn_tx_hash: burnTxHash,
      source_chain: sourceChain,
      source_domain: chain.domain,
      amount,
      status: 'pending',
    })
    .select()
    .single();
  if (insertErr) throw new Error(`Failed to create deposit record: ${insertErr.message}`);

  // Fire-and-forget the attestation polling + escrow lock
  processAttestation(deposit.id, burnTxHash, chain.domain, dealId, buyerWallet, amount)
    .catch(err => logger.error({ depositId: deposit.id, err: err.message }, 'Cross-chain deposit processing failed'));

  return { depositId: deposit.id, status: 'pending' };
}

/**
 * Background process: poll for attestation, then lock funds into escrow.
 */
async function processAttestation(depositId, burnTxHash, sourceDomain, dealId, buyerWallet, amount) {
  try {
    // Update status to attesting
    await supabase
      .from('cross_chain_deposits')
      .update({ status: 'attesting' })
      .eq('id', depositId);

    const { attestation, message } = await pollForAttestation(burnTxHash, sourceDomain);

    // Store the attestation
    await supabase
      .from('cross_chain_deposits')
      .update({
        status: 'attested',
        attestation,
        cctp_message: message,
      })
      .eq('id', depositId);

    // Now lock funds into escrow on Stellar
    await lockCrossChainFunds(depositId, dealId, buyerWallet, amount);

  } catch (err) {
    logger.error({ depositId, err: err.message }, 'Cross-chain deposit failed');
    await supabase
      .from('cross_chain_deposits')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', depositId);

    // Revert deal status
    await supabase
      .from('deals')
      .update({ status: 'created' })
      .eq('id', dealId);
  }
}

/**
 * Lock the equivalent USDC amount into escrow on Stellar after attestation.
 * In production this would call the Soroban escrow contract. For now we
 * build a Stellar payment from the platform's USDC holdings.
 */
async function lockCrossChainFunds(depositId, dealId, buyerWallet, amount) {
  await supabase
    .from('cross_chain_deposits')
    .update({ status: 'locking' })
    .eq('id', depositId);

  try {
    const keypair = StellarSdk.Keypair.fromSecret(ESCROW_SECRET);
    const account = await server.loadAccount(keypair.publicKey());

    const usdcAsset = new StellarSdk.Asset(
      'USDC',
      process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    );

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: ESCROW_PUBLIC,
        asset: usdcAsset,
        amount: String(amount),
      }))
      .addMemo(StellarSdk.Memo.text(`cctp:${dealId.slice(0, 20)}`))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);

    if (!result.successful) {
      throw new Error(`Stellar tx ${result.hash} was not successful`);
    }

    // Update deposit and deal
    await supabase
      .from('cross_chain_deposits')
      .update({
        status: 'completed',
        stellar_tx_hash: result.hash,
        stellar_ledger: result.ledger,
      })
      .eq('id', depositId);

    await supabase
      .from('deals')
      .update({
        status: 'locked',
        tx_hash: result.hash,
        tx_ledger: result.ledger,
        payment_method: 'cctp',
      })
      .eq('id', dealId);

    logger.info({ depositId, dealId, txHash: result.hash }, 'Cross-chain deposit completed and escrow locked');

  } catch (err) {
    throw new Error(`Failed to lock escrow: ${err.message}`);
  }
}

/**
 * Get the status of a cross-chain deposit.
 */
async function getDepositStatus(depositId, wallet) {
  const { data, error } = await supabase
    .from('cross_chain_deposits')
    .select('*')
    .eq('id', depositId)
    .single();

  if (error) throw new DealNotFoundError();
  if (data.buyer_wallet !== wallet) throw new NotBuyerError();

  return {
    id: data.id,
    dealId: data.deal_id,
    sourceChain: data.source_chain,
    amount: data.amount,
    status: data.status,
    burnTxHash: data.burn_tx_hash,
    stellarTxHash: data.stellar_tx_hash,
    errorMessage: data.error_message,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Resume processing for deposits that were left in pending/attesting state
 * (e.g. after a server restart). Called on startup.
 */
async function resumeStaleDeposits() {
  const { data: stale } = await supabase
    .from('cross_chain_deposits')
    .select('*')
    .in('status', ['pending', 'attesting']);

  if (!stale || stale.length === 0) {
    logger.info('No stale cross-chain deposits to resume');
    return;
  }

  logger.info({ count: stale.length }, 'Resuming stale cross-chain deposits');

  for (const deposit of stale) {
    try {
      const chain = getChainConfig(deposit.source_chain);
      if (!chain) {
        await supabase
          .from('cross_chain_deposits')
          .update({ status: 'failed', error_message: 'Unknown source chain' })
          .eq('id', deposit.id);
        continue;
      }

      processAttestation(
        deposit.id,
        deposit.burn_tx_hash,
        chain.domain,
        deposit.deal_id,
        deposit.buyer_wallet,
        deposit.amount
      ).catch(err => logger.error({ depositId: deposit.id, err: err.message }, 'Resume failed'));
    } catch (err) {
      logger.error({ depositId: deposit.id, err: err.message }, 'Failed to resume deposit');
    }
  }
}

module.exports = {
  initiateCrossChainDeposit,
  getDepositStatus,
  resumeStaleDeposits,
};
