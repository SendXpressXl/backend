const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

// Verifies milestone deal creation, confirmation, and idempotency guards
// (issue #51) by mounting the real milestones router with a fake in-memory
// Supabase and a fake Stellar escrow service.

class FakeQuery {
  constructor(store, table, op, payload) {
    this.store = store;
    this.table = table;
    this.op = op;
    this.payload = payload;
    this.filters = [];
    this._single = false;
    this._wantSelect = false;
    this._orderBy = null;
  }
  eq(col, val) { this.filters.push({ col, val, type: 'eq' }); return this; }
  neq(col, val) { this.filters.push({ col, val, type: 'neq' }); return this; }
  is(col, val) { this.filters.push({ col, val, type: 'is' }); return this; }
  lt(col, val) { this.filters.push({ col, val, type: 'lt' }); return this; }
  order() { this._orderBy = arguments; return this; }
  select() { this._wantSelect = true; return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) {
    try { resolve(this._execute()); } catch (e) { reject(e); }
  }
  _match(rows) {
    return rows.filter(r => this.filters.every(f => {
      if (f.type === 'eq') return r[f.col] === f.val;
      if (f.type === 'neq') return r[f.col] !== f.val;
      if (f.type === 'is') return f.val === null ? (r[f.col] ?? null) === null : r[f.col] === f.val;
      if (f.type === 'lt') return r[f.col] < f.val;
      return true;
    }));
  }
  _execute() {
    if (this.table === 'deal_transitions') {
      if (this.op === 'insert') { this.store.transitions.push(this.payload); return { data: this.payload, error: null }; }
    }
    const collection = this.table === 'deal_milestones' ? this.store.milestones : this.store.deals;
    const all = Array.from(collection.values());

    if (this.op === 'select') {
      const rows = this._match(all);
      if (this._single) {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
      }
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of rows) {
        if (!row.id) row.id = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        collection.set(row.id, row);
      }
      return { data: rows.length === 1 ? rows[0] : rows, error: null };
    }
    if (this.op === 'update') {
      const rows = this._match(all);
      if (this._single && rows.length !== 1) {
        return { data: null, error: { message: 'no rows matched update', code: 'PGRST116' } };
      }
      for (const row of rows) Object.assign(row, this.payload);
      if (this._single) return { data: rows[0], error: null };
      return { data: rows, error: null };
    }
    return { data: null, error: { message: `unhandled op ${this.op}` } };
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

function makeFakeEscrow() {
  const calls = { release: 0 };
  const control = { releaseThrows: false };
  return {
    module: {
      releaseFunds: async (_secret, _seller, amount, _dealId, _asset) => {
        calls.release++;
        if (control.releaseThrows) throw new Error('simulated Stellar failure');
        return { hash: `tx-release-${calls.release}`, ledger: 1000 + calls.release };
      },
      refund: async () => ({ hash: 'tx-refund', ledger: 2000 }),
      buildLockTx: async () => { throw new Error('not used in this test'); },
      submitSignedTx: async () => { throw new Error('not used in this test'); },
      verifyTransaction: async () => ({ verified: true }),
      formatAmount: (amt) => Number(amt).toFixed(7),
      USDC_ASSET: { code: 'USDC', issuer: 'GA5ZSEJYB37JDD5G4LYXOKMWSUVC5HBH724QZDU5DHVJ76SCZGR5SOY3' },
    },
    calls,
    control,
  };
}

function stubModule(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj };
}

function buildApp(store, fakeEscrow) {
  const supabasePath = require.resolve('../src/config/supabase');
  const escrowPath = require.resolve('../src/services/escrow');
  const authPath = require.resolve('../src/middleware/auth');
  const milestonesPath = require.resolve('../src/routes/milestones');
  const transitionsPath = require.resolve('../src/services/dealTransitions');
  const stateMachinePath = require.resolve('../src/services/dealStateMachine');

  stubModule(supabasePath, makeFakeSupabase(store));
  stubModule(escrowPath, fakeEscrow.module);
  stubModule(authPath, {
    requireAuth: (req, res, next) => { req.wallet = req.headers['x-test-wallet']; next(); },
    optionalAuth: (req, res, next) => next(),
    requireRole: () => (req, res, next) => next(),
    issueChallenge: () => {},
    verifySignature: () => {},
    logout: () => {},
  });

  delete require.cache[transitionsPath];
  delete require.cache[stateMachinePath];
  delete require.cache[milestonesPath];
  const milestonesRouter = require('../src/routes/milestones');

  const app = express();
  app.use(express.json());
  app.use('/api/milestones', milestonesRouter);
  return app;
}

function makeDeal(store, overrides) {
  const deal = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    buyer: 'G' + 'A'.repeat(55),
    seller: 'G' + 'B'.repeat(55),
    amount: 100,
    status: 'locked',
    is_milestone_deal: true,
    release_tx: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  store.deals.set(deal.id, deal);
  return deal;
}

function makeMilestone(store, dealId, overrides) {
  const ms = {
    id: '11111111-2222-4333-8444-555555555555',
    deal_id: dealId,
    sequence: 1,
    label: 'Prototype',
    amount: 30,
    status: 'shipped',
    release_tx: null,
    release_ledger: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  store.milestones.set(ms.id, ms);
  return ms;
}

async function withServer(store, fakeEscrow, fn) {
  const app = buildApp(store, fakeEscrow);
  const server = app.listen(0);
  try {
    const port = server.address().port;
    await fn(`http://localhost:${port}/api/milestones`, store);
  } finally {
    server.close();
  }
}

const WALLET_A = 'G' + 'A'.repeat(55);
const WALLET_B = 'G' + 'B'.repeat(55);

test('create milestone deal: milestones must sum to deal amount', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': WALLET_A },
      body: JSON.stringify({
        seller: WALLET_B,
        amount: 100,
        description: 'Milestone project',
        milestones: [
          { label: 'Design', amount: 30 },
          { label: 'Build', amount: 30 },
          { label: 'Ship', amount: 40 },
        ],
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.is_milestone_deal, true);
    assert.equal(body.milestones.length, 3);
    assert.equal(body.milestones[0].status, 'pending');
  });
});

test('create milestone deal: rejects when milestones do not sum to deal amount', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': WALLET_A },
      body: JSON.stringify({
        seller: WALLET_B,
        amount: 100,
        description: 'Bad milestones',
        milestones: [
          { label: 'Part 1', amount: 30 },
          { label: 'Part 2', amount: 30 },
        ],
      }),
    });
    assert.equal(res.status, 400);
  });
});

test('confirm milestone: happy path releases partial funds and confirms', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store);
  const ms = makeMilestone(store, deal.id, { status: 'shipped', amount: 30 });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'confirmed');
    assert.equal(fakeEscrow.calls.release, 1);
    assert.equal(store.milestones.get(ms.id).status, 'confirmed');
  });
});

test('confirm milestone: crash recovery — already confirmed with release_tx does not re-call releaseFunds', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store);
  const ms = makeMilestone(store, deal.id, {
    status: 'confirming',
    release_tx: 'tx-already-sent',
    release_ledger: 999,
  });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.tx_hash, 'tx-already-sent');
    assert.equal(fakeEscrow.calls.release, 0, 'must not re-call releaseFunds');
  });
});

test('confirm milestone: blocked when confirming with no release_tx yet', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store);
  const ms = makeMilestone(store, deal.id, { status: 'confirming', release_tx: null });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    assert.equal(res.status, 409);
    assert.equal(fakeEscrow.calls.release, 0);
  });
});

test('confirm milestone: idempotent — second call after full confirmation is a no-op', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store);
  const ms = makeMilestone(store, deal.id, { status: 'confirmed', release_tx: 'tx-final' });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.tx_hash, 'tx-final');
    assert.equal(fakeEscrow.calls.release, 0);
  });
});

test('dispute milestone: flips milestone and parent deal to disputed', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store);
  const ms = makeMilestone(store, deal.id, { status: 'shipped' });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms.id}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'disputed');
    assert.equal(store.milestones.get(ms.id).status, 'disputed');
    assert.equal(store.deals.get(deal.id).status, 'disputed');
  });
});

test('all milestones confirmed: parent deal auto-finalizes', async () => {
  const store = { deals: new Map(), milestones: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = makeDeal(store, { amount: 60 });
  const ms1 = makeMilestone(store, deal.id, { sequence: 1, amount: 30, status: 'confirmed', release_tx: 'tx-1' });
  const ms2 = makeMilestone(store, deal.id, { id: '66666666-7777-4888-8999-aaaaaaaaaaaa', sequence: 2, amount: 30, status: 'shipped' });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/deals/${deal.id}/milestones/${ms2.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer },
      body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(store.deals.get(deal.id).status, 'confirmed', 'deal should auto-finalize when all milestones are confirmed');
  });
});
