/**
 * Central definition of valid deal status transitions.
 *
 * Every place in routes/deals.js that used to do an inline
 * `if (deal.status !== 'x')` check goes through canTransition() instead, so
 * the full lifecycle lives in one place and can't drift between handlers.
 *
 * created    -> locking       (buyer starts locking funds via crypto)
 * created    -> fiat_pending  (buyer starts fiat on-ramp)
 * locking    -> locked        (Stellar submission succeeded)
 * locking    -> created       (Stellar submission failed, reverted)
 * fiat_pending -> fiat_locked (webhook confirms USDC received)
 * fiat_pending -> created     (payment failed, can retry)
 * locked     -> shipped       (seller ships)
 * fiat_locked -> shipped      (seller ships — same as locked)
 * shipped    -> confirming    (buyer starts confirming)
 * shipped    -> disputed
 * shipped    -> expired       (no confirmation within the expiry window)
 * confirming -> confirmed     (funds released)
 * created    -> cancelling    (buyer cancels before shipment)
 * created    -> disputed
 * cancelling -> cancelled     (funds refunded)
 *
 * Cross-chain CCTP deposits follow the same created -> locking -> locked
 * path, but the locking step is triggered server-side after attestation
 * instead of by a client-signed XDR. The payment_method column on deals
 * tracks whether the lock came from a direct XLM payment or a CCTP deposit.
 */
const TRANSITIONS = {
  created:      ['locking', 'fiat_pending', 'cancelling', 'disputed'],
  locking:      ['locked', 'created'],
  fiat_pending: ['fiat_locked', 'created'],
  locked:       ['shipped'],
  fiat_locked:  ['shipped'],
  shipped:      ['confirming', 'disputed', 'expired'],
  confirming:   ['confirmed'],
  cancelling:   ['cancelled'],
  confirmed:    [],
  cancelled:    [],
  disputed:     [],
  expired:      [],
};

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

// A deal sitting in "shipped" this long without buyer confirmation is
// treated as stale and gets auto-flagged as "expired" so it surfaces for
// review instead of sitting invisibly forever. Not wired to any automatic
// refund — that needs the admin/dispute resolution flow from #39.
const SHIPPED_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// A deal sitting in "fiat_pending" this long without the webhook confirming
// payment is reverted to "created" so the buyer can retry or pay with crypto.
const FIAT_PENDING_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

module.exports = { TRANSITIONS, canTransition, SHIPPED_EXPIRY_MS, FIAT_PENDING_EXPIRY_MS };
