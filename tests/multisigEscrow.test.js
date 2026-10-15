const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const express = require('express');
const {
  getHighValueThreshold,
  getDealTier,
  getEscrowDestination,
  getApprovedSigners,
  getRequiredThreshold,
  checkSignerApproval,
  evaluateDisputeResolution,
  DEFAULT_SIGNERS,
  MULTISIG_ESCROW_PUBLIC,
  STANDARD_ESCROW_PUBLIC,
} = require('../src/services/multisigEscrow');

describe('Multi-Sig Escrow Service (Issue #50)', () => {
  test('tier determination based on configurable threshold', () => {
    assert.equal(getHighValueThreshold(), 5000);
    assert.equal(getDealTier(100), 'standard');
    assert.equal(getDealTier(4999.99), 'standard');
    assert.equal(getDealTier(5000), 'high_value');
    assert.equal(getDealTier(15000), 'high_value');
    assert.equal(getDealTier('invalid'), 'standard');
  });

  test('escrow destination routing per tier', () => {
    assert.equal(getEscrowDestination('standard'), STANDARD_ESCROW_PUBLIC);
    assert.equal(getEscrowDestination('high_value'), MULTISIG_ESCROW_PUBLIC);
    assert.notEqual(getEscrowDestination('standard'), getEscrowDestination('high_value'));
  });

  test('approved signers and threshold per tier', () => {
    const standardSigners = getApprovedSigners('standard');
    assert.equal(standardSigners.length, 1);
    assert.equal(getRequiredThreshold('standard'), 1);

    const highValueSigners = getApprovedSigners('high_value');
    assert.equal(highValueSigners.length, 3);
    assert.equal(getRequiredThreshold('high_value'), 2);

    const roles = highValueSigners.map((s) => s.role);
    assert.deepEqual(roles.sort(), ['arbitrator', 'dao', 'platform']);
  });

  test('signer authorization checks', () => {
    const platformCheck = checkSignerApproval(DEFAULT_SIGNERS.platform, 'high_value');
    assert.equal(platformCheck.isApproved, true);
    assert.equal(platformCheck.role, 'platform');

    const arbitratorCheck = checkSignerApproval(DEFAULT_SIGNERS.arbitrator, 'high_value');
    assert.equal(arbitratorCheck.isApproved, true);
    assert.equal(arbitratorCheck.role, 'arbitrator');

    const randomWallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA0';
    assert.equal(checkSignerApproval(randomWallet, 'high_value').isApproved, false);
    assert.equal(checkSignerApproval(randomWallet, 'standard').isApproved, false);
  });

  test('majority threshold dispute vote evaluation (2-of-3)', () => {
    // 0 votes
    const eval0 = evaluateDisputeResolution([], 'high_value');
    assert.equal(eval0.resolved, false);
    assert.equal(eval0.required, 2);

    // 1 vote for release_seller (not yet resolved)
    const votes1 = [
      { signer: DEFAULT_SIGNERS.platform, role: 'platform', vote: 'release_seller' },
    ];
    const eval1 = evaluateDisputeResolution(votes1, 'high_value');
    assert.equal(eval1.resolved, false);
    assert.equal(eval1.voteCounts.release_seller, 1);

    // 1 vote release_seller + 1 vote refund_buyer (split vote, not yet resolved)
    const votesSplit = [
      { signer: DEFAULT_SIGNERS.platform, role: 'platform', vote: 'release_seller' },
      { signer: DEFAULT_SIGNERS.arbitrator, role: 'arbitrator', vote: 'refund_buyer' },
    ];
    const evalSplit = evaluateDisputeResolution(votesSplit, 'high_value');
    assert.equal(evalSplit.resolved, false);

    // 2 votes for release_seller -> majority reached
    const votes2 = [
      { signer: DEFAULT_SIGNERS.platform, role: 'platform', vote: 'release_seller' },
      { signer: DEFAULT_SIGNERS.dao, role: 'dao', vote: 'release_seller' },
    ];
    const eval2 = evaluateDisputeResolution(votes2, 'high_value');
    assert.equal(eval2.resolved, true);
    assert.equal(eval2.winningVote, 'release_seller');

    // 2 votes for refund_buyer -> majority reached
    const votesRefund = [
      { signer: DEFAULT_SIGNERS.arbitrator, role: 'arbitrator', vote: 'refund_buyer' },
      { signer: DEFAULT_SIGNERS.dao, role: 'dao', vote: 'refund_buyer' },
    ];
    const evalRefund = evaluateDisputeResolution(votesRefund, 'high_value');
    assert.equal(evalRefund.resolved, true);
    assert.equal(evalRefund.winningVote, 'refund_buyer');
  });
});

// Integration tests with in-memory Express and fake Supabase
class FakeQuery {
  constructor(store, table, op, payload) {
    this.store = store;
    this.table = table;
    this.op = op;
    this.payload = payload;
    this.filters = [];
    this._single = false;
  }
  eq(col, val) { this.filters.push({ col, val, type: 'eq' }); return this; }
  select() { return this; }
  order() { return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) {
    try { resolve(this._run()); } catch (e) { reject(e); }
  }
  _run() {
    if (this.table === 'deal_transitions') {
      if (this.op === 'insert') {
        this.store.transitions.push(this.payload);
        return { data: this.payload, error: null };
      }
      return { data: this.store.transitions, error: null };
    }
    if (this.table === 'deal_dispute_votes') {
      if (this.op === 'insert') {
        const row = { id: `vote-${Date.now()}-${Math.random()}`, ...this.payload };
        this.store.disputeVotes.push(row);
        return { data: row, error: null };
      }
      if (this.op === 'select') {
        const matches = this.store.disputeVotes.filter((r) =>
          this.filters.every((f) => r[f.col] === f.val)
        );
        if (this._single) {
          return matches.length > 0
            ? { data: matches[0], error: null }
            : { data: null, error: { message: 'no rows' } };
        }
        return { data: matches, error: null };
      }
    }
    if (this.table === 'deals') {
      const all = Array.from(this.store.deals.values());
      if (this.op === 'select') {
        const matches = all.filter((r) =>
          this.filters.every((f) => r[f.col] === f.val)
        );
        if (this._single) {
          return matches.length === 1
            ? { data: matches[0], error: null }
            : { data: null, error: { message: 'Deal not found' } };
        }
        return { data: matches, error: null };
      }
      if (this.op === 'insert') {
        const row = { id: `deal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...this.payload };
        this.store.deals.set(row.id, row);
        return { data: row, error: null };
      }
      if (this.op === 'update') {
        const matches = all.filter((r) =>
          this.filters.every((f) => r[f.col] === f.val)
        );
        for (const row of matches) {
          Object.assign(row, this.payload);
        }
        return { data: matches.length === 1 ? matches[0] : matches, error: null };
      }
    }
    return { data: null, error: null };
  }
}

function makeFakeSupabase(store) {
  return {
    from(table) {
      return {
        select: () => new FakeQuery(store, table, 'select', null),
        update: (patch) => new FakeQuery(store, table, 'update', patch),
        insert: (row) => new FakeQuery(store, table, 'insert', row),
      };
    },
  };
}

function stubModule(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj };
}

function buildApp(store, fakeEscrow) {
  const supabasePath = require.resolve('../src/config/supabase');
  const escrowPath = require.resolve('../src/services/escrow');
  const authPath = require.resolve('../src/middleware/auth');
  const dealsPath = require.resolve('../src/routes/deals');
  const transitionsPath = require.resolve('../src/services/dealTransitions');
  const stateMachinePath = require.resolve('../src/services/dealStateMachine');

  stubModule(supabasePath, makeFakeSupabase(store));
  stubModule(escrowPath, fakeEscrow);
  stubModule(authPath, {
    requireAuth: (req, res, next) => { req.wallet = req.headers['x-test-wallet']; next(); },
    optionalAuth: (req, res, next) => next(),
    requireRole: () => (req, res, next) => next(),
  });

  delete require.cache[transitionsPath];
  delete require.cache[stateMachinePath];
  delete require.cache[dealsPath];
  const dealsRouter = require('../src/routes/deals');

  const app = express();
  app.use(express.json());
  app.use('/api/deals', dealsRouter);
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}/api/deals`);
  } finally {
    server.close();
  }
}

describe('Multi-Sig Deals Endpoints Integration', () => {
  const sellerWallet = 'G' + 'B'.repeat(55);
  const buyerWallet = 'G' + 'A'.repeat(55);

  test('GET /api/deals/tiers/config returns tier threshold and signer configurations', async () => {
    const store = { deals: new Map(), transitions: [], disputeVotes: [] };
    const fakeEscrow = {
      buildLockTx: async () => 'sample_xdr',
      releaseFunds: async () => ({ hash: 'tx_rel', ledger: 100 }),
      refund: async () => ({ hash: 'tx_ref', ledger: 101 }),
      formatAmount: (amt) => Number(amt).toFixed(7),
    };
    const app = buildApp(store, fakeEscrow);

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/tiers/config`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.highValueThreshold, 5000);
      assert.equal(data.tiers.standard.requiredVotes, 1);
      assert.equal(data.tiers.high_value.requiredVotes, 2);
      assert.equal(data.tiers.high_value.signers.length, 3);
    });
  });

  test('POST /api/deals creates standard tier for amount < 5000 and high_value for >= 5000', async () => {
    const store = { deals: new Map(), transitions: [], disputeVotes: [] };
    const fakeEscrow = {
      buildLockTx: async () => 'sample_xdr',
      releaseFunds: async () => ({ hash: 'tx_rel', ledger: 100 }),
      refund: async () => ({ hash: 'tx_ref', ledger: 101 }),
      formatAmount: (amt) => Number(amt).toFixed(7),
    };
    const app = buildApp(store, fakeEscrow);

    await withServer(app, async (base) => {
      // 1. Create standard deal ($1000)
      const res1 = await fetch(`${base}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': buyerWallet },
        body: JSON.stringify({ seller: sellerWallet, amount: 1000, description: 'Standard Deal' }),
      });
      assert.equal(res1.status, 201);
      const deal1 = await res1.json();
      assert.equal(deal1.deal_tier, 'standard');
      assert.equal(deal1.escrow_destination, STANDARD_ESCROW_PUBLIC);

      // 2. Create high-value deal ($10,000)
      const res2 = await fetch(`${base}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': buyerWallet },
        body: JSON.stringify({ seller: sellerWallet, amount: 10000, description: 'High Value B2B Deal' }),
      });
      assert.equal(res2.status, 201);
      const deal2 = await res2.json();
      assert.equal(deal2.deal_tier, 'high_value');
      assert.equal(deal2.escrow_destination, MULTISIG_ESCROW_PUBLIC);
    });
  });

  test('GET /api/deals/lock-tx routes high-value deals to multisig escrow address', async () => {
    let capturedEscrow = null;
    const store = { deals: new Map(), transitions: [], disputeVotes: [] };
    const fakeEscrow = {
      buildLockTx: async (buyer, escrow, amount, dealId) => {
        capturedEscrow = escrow;
        return `xdr_for_${escrow}`;
      },
      releaseFunds: async () => ({ hash: 'tx_rel', ledger: 100 }),
      refund: async () => ({ hash: 'tx_ref', ledger: 101 }),
      formatAmount: (amt) => Number(amt).toFixed(7),
    };
    const app = buildApp(store, fakeEscrow);

    // Pre-populate high-value deal
    const highValueDeal = {
      id: '00000000-0000-4000-8000-000000000001',
      buyer: buyerWallet,
      seller: sellerWallet,
      amount: 8000,
      description: 'High value',
      status: 'created',
      deal_tier: 'high_value',
      escrow_destination: MULTISIG_ESCROW_PUBLIC,
    };
    store.deals.set(highValueDeal.id, highValueDeal);

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/lock-tx?amount=8000&dealId=${highValueDeal.id}`, {
        headers: { 'x-test-wallet': buyerWallet },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.deal_tier, 'high_value');
      assert.equal(data.escrow_destination, MULTISIG_ESCROW_PUBLIC);
      assert.equal(capturedEscrow, MULTISIG_ESCROW_PUBLIC);
    });
  });

  test('Multi-sig dispute resolution: voting threshold, duplicate rejection, and majority execution', async () => {
    let releasedSeller = null;
    const store = { deals: new Map(), transitions: [], disputeVotes: [] };
    const fakeEscrow = {
      buildLockTx: async () => 'sample_xdr',
      releaseFunds: async (_sec, seller, amount, dealId) => {
        releasedSeller = seller;
        return { hash: 'tx_release_dispute_resolved', ledger: 550 };
      },
      refund: async () => ({ hash: 'tx_ref', ledger: 101 }),
      formatAmount: (amt) => Number(amt).toFixed(7),
    };
    const app = buildApp(store, fakeEscrow);

    const disputedDeal = {
      id: '00000000-0000-4000-8000-000000000002',
      buyer: buyerWallet,
      seller: sellerWallet,
      amount: 15000,
      description: 'Large disputed trade',
      status: 'disputed',
      deal_tier: 'high_value',
      escrow_destination: MULTISIG_ESCROW_PUBLIC,
    };
    store.deals.set(disputedDeal.id, disputedDeal);

    await withServer(app, async (base) => {
      // 1. Unauthorized signer attempt -> 403
      const unauthRes = await fetch(`${base}/${disputedDeal.id}/dispute-resolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': buyerWallet },
        body: JSON.stringify({ vote: 'release_seller', note: 'Buyer trying to vote as arbiter' }),
      });
      assert.equal(unauthRes.status, 403);

      // 2. First vote from Platform signer -> accepted, but pending (1/2)
      const vote1Res = await fetch(`${base}/${disputedDeal.id}/dispute-resolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': DEFAULT_SIGNERS.platform },
        body: JSON.stringify({ vote: 'release_seller', note: 'Platform verified shipment delivery' }),
      });
      assert.equal(vote1Res.status, 200);
      const vote1Data = await vote1Res.json();
      assert.equal(vote1Data.success, true);
      assert.equal(vote1Data.resolved, false);
      assert.equal(vote1Data.evaluation.voteCounts.release_seller, 1);
      assert.equal(store.deals.get(disputedDeal.id).status, 'disputed');

      // 3. Duplicate vote from same signer -> 409
      const dupRes = await fetch(`${base}/${disputedDeal.id}/dispute-resolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': DEFAULT_SIGNERS.platform },
        body: JSON.stringify({ vote: 'release_seller' }),
      });
      assert.equal(dupRes.status, 409);

      // 4. Query dispute resolutions endpoint -> returns audit trail
      const queryRes = await fetch(`${base}/${disputedDeal.id}/dispute-resolutions`, {
        headers: { 'x-test-wallet': DEFAULT_SIGNERS.arbitrator },
      });
      assert.equal(queryRes.status, 200);
      const queryData = await queryRes.json();
      assert.equal(queryData.votes.length, 1);
      assert.equal(queryData.requiredVotes, 2);

      // 5. Second vote from Arbitrator -> majority (2-of-3) reached, resolves dispute!
      const vote2Res = await fetch(`${base}/${disputedDeal.id}/dispute-resolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-wallet': DEFAULT_SIGNERS.arbitrator },
        body: JSON.stringify({ vote: 'release_seller', note: 'Independent arbitrator agrees delivery is valid' }),
      });
      assert.equal(vote2Res.status, 200);
      const vote2Data = await vote2Res.json();
      assert.equal(vote2Data.success, true);
      assert.equal(vote2Data.resolved, true);
      assert.equal(vote2Data.winningVote, 'release_seller');
      assert.equal(vote2Data.tx_hash, 'tx_release_dispute_resolved');

      // Deal status flipped to confirmed and seller was released funds!
      assert.equal(store.deals.get(disputedDeal.id).status, 'confirmed');
      assert.equal(releasedSeller, sellerWallet);
    });
  });
});
