const supabase = require('../config/supabase');
const { logger } = require('../lib/logger');
const { SHIPPED_EXPIRY_MS } = require('./dealStateMachine');

/**
 * Best-effort audit log write for a deal status change. Failures are logged,
 * never thrown — a logging outage must not block the transition it records.
 *
 * @param {string} dealId
 * @param {string} actorWallet - wallet that triggered the change, or 'system'
 * @param {string} fromStatus
 * @param {string} toStatus
 * @param {string} [reason]
 */
async function logTransition(dealId, actorWallet, fromStatus, toStatus, reason = null) {
  const { error } = await supabase.from('deal_transitions').insert({
    deal_id: dealId,
    actor_wallet: actorWallet,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
  });

  if (error) {
    logger.error({ err: error, dealId, fromStatus, toStatus }, 'Failed to record deal transition');
  }
}

/**
 * If a deal has sat in "shipped" past SHIPPED_EXPIRY_MS without confirmation,
 * flip it to "expired" so it surfaces for review instead of going stale
 * silently forever. There's no worker/cron in this repo, so this runs lazily
 * whenever a deal is read (GET /:id, GET /, and the top of confirm).
 *
 * @param {object} deal
 * @returns {Promise<object>} the deal, updated if it just expired
 */
async function expireIfStale(deal) {
  if (deal.status !== 'shipped' || !deal.shipped_at) return deal;

  const shippedAt = new Date(deal.shipped_at).getTime();
  if (Date.now() - shippedAt < SHIPPED_EXPIRY_MS) return deal;

  const { data: updated, error } = await supabase
    .from('deals')
    .update({ status: 'expired' })
    .eq('id', deal.id)
    .eq('status', 'shipped') // guard against a race with confirm/dispute
    .select()
    .single();

  if (error || !updated) return deal; // lost the race, or a DB error — leave the deal as read

  await logTransition(deal.id, 'system', 'shipped', 'expired', 'no buyer confirmation within the expiry window');
  return updated;
}

module.exports = { logTransition, expireIfStale };
