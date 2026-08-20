const supabase = require('../config/supabase');
const { logger } = require('../lib/logger');
const { SHIPPED_EXPIRY_MS, FIAT_PENDING_EXPIRY_MS } = require('./dealStateMachine');

const MILESTONE_SHIPPED_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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
  // Fiat pending expiry — revert to created after timeout so buyer can retry
  if (deal.status === 'fiat_pending' && deal.created_at) {
    const createdAt = new Date(deal.created_at).getTime();
    if (Date.now() - createdAt >= FIAT_PENDING_EXPIRY_MS) {
      const { data: updated, error } = await supabase
        .from('deals')
        .update({ status: 'created', payment_method: 'crypto' })
        .eq('id', deal.id)
        .eq('status', 'fiat_pending')
        .select()
        .single();

      if (!error && updated) {
        await logTransition(deal.id, 'system', 'fiat_pending', 'created', 'fiat payment timed out');
        return updated;
      }
    }
    return deal;
  }

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

  await logTransition(deal.id, 'system', 'shipped', 'expired', 'no buyer confirmation within the expiry window');
  return updated;
}

/**
 * Expire milestones that have been shipped past MILESTONE_SHIPPED_EXPIRY_MS
 * without buyer confirmation. This is a best-effort sweep — a single milestone
 * being expired does not automatically expire the whole deal.
 *
 * @param {string} dealId
 * @returns {Promise<number>} number of milestones that were expired
 */
async function expireStaleMilestones(dealId) {
  const cutoff = new Date(Date.now() - MILESTONE_SHIPPED_EXPIRY_MS).toISOString();

  const { data: stale, error: fetchErr } = await supabase
    .from('deal_milestones')
    .select('*')
    .eq('deal_id', dealId)
    .eq('status', 'shipped')
    .lt('updated_at', cutoff);

  if (fetchErr || !stale || stale.length === 0) return 0;

  let expired = 0;
  for (const ms of stale) {
    // Best-effort: flip shipped -> expired (a race with confirm is harmless)
    const { error: updErr } = await supabase
      .from('deal_milestones')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', ms.id)
      .eq('status', 'shipped');
    if (!updErr) {
      await logTransition(dealId, 'system', `milestone:${ms.sequence}:shipped`, `milestone:${ms.sequence}:disputed`, 'milestone shipped too long without confirmation');
      expired++;
    }
  }
  return expired;
}

module.exports = { logTransition, expireIfStale, expireStaleMilestones };
