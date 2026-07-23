const supabase = require('../config/supabase');

// A deal in any of these statuses has nothing left owed to either side —
// everything before them still has escrow funds or a listing commitment
// riding on this wallet staying a seller.
const RESOLVED_DEAL_STATUSES = ['confirmed', 'cancelled'];

/**
 * True if dropping seller capability for this user would leave an active
 * listing or an in-progress deal (as seller) with no one responsible for it.
 * There's no cascade handling yet to auto-close those out, so a downgrade
 * is blocked rather than silently orphaning them.
 *
 * @param {string} userId - users.id (uuid)
 * @param {string} wallet - the same user's Stellar public key
 */
async function hasActiveSellerObligations(userId, wallet) {
  const [{ data: listings }, { data: deals }] = await Promise.all([
    supabase.from('listings').select('id').eq('seller_id', userId).eq('status', 'active').limit(1),
    supabase.from('deals').select('id').eq('seller', wallet)
      .not('status', 'in', `(${RESOLVED_DEAL_STATUSES.join(',')})`).limit(1),
  ]);

  return (listings?.length ?? 0) > 0 || (deals?.length ?? 0) > 0;
}

module.exports = { hasActiveSellerObligations, RESOLVED_DEAL_STATUSES };
