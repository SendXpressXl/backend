/**
 * Central definition of valid deal status transitions.
 *
 * Every place in routes/deals.js that used to do an inline
 * `if (deal.status !== 'x')` check goes through canTransition() instead, so
 * the full lifecycle lives in one place and can't drift between handlers.
 *
 * created    -> locking    (buyer starts locking funds)
 * locking    -> locked     (Stellar submission succeeded)
 * locking    -> created    (Stellar submission failed, reverted)
 * locked     -> shipped    (seller ships)
 * shipped    -> confirming (buyer starts confirming)
 * shipped    -> disputed
 * shipped    -> expired    (no confirmation within the expiry window)
 * confirming -> confirmed  (funds released)
 * created    -> cancelling (buyer cancels before shipment)
 * created    -> disputed
 * cancelling -> cancelled  (funds refunded)
 */
const TRANSITIONS = {
  created:    ['locking', 'cancelling', 'disputed'],
  locking:    ['locked', 'created'],
  locked:     ['shipped'],
  shipped:    ['confirming', 'disputed', 'expired'],
  confirming: ['confirmed'],
  cancelling: ['cancelled'],
  confirmed:  [],
  cancelled:  [],
  disputed:   [],
  expired:    [],
};

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

// A deal sitting in "shipped" this long without buyer confirmation is
// treated as stale and gets auto-flagged as "expired" so it surfaces for
// review instead of sitting invisibly forever. Not wired to any automatic
// refund — that needs the admin/dispute resolution flow from #39.
const SHIPPED_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

module.exports = { TRANSITIONS, canTransition, SHIPPED_EXPIRY_MS };
