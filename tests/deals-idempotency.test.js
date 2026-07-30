const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const express = require('express');

// Verifies the double-spend/idempotency guard on /confirm and /cancel
// (issue #36) by mounting the real deals router with a fake in-memory
// Supabase and a fake Stellar escrow service, so we can force the exact
// crash and race states the issue describes and check releaseFunds/refund
// are never called more than once per deal.

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
  is(col, val) { this.filters.push({ col, val, type: 'is' }); return this; }
  order() { return this; }
  select() { this._wantSelect = true; return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) {
    try { resolve(this._execute()); } catch (e) { reject(e); }
  }
  _match(rows) {
    return rows.filter(r => this.filters.every(f =>
      f.type === 'is' ? (f.val === null ? (r[f.col] ?? null) === null : r[f.col] === f.val)
                       : r[f.col] === f.val
    ));
  }
  _execute() {
    if (this.table === 'deal_transitions') {
      if (this.op === 'insert') { this.store.transitions.push(this.payload); return { data: this.payload, error: null }; }
    }
    const all = Array.from(this.store.deals.values());
    if (this.op === 'select') {
      const rows = this._match(all);
      if (this._single) {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
      }
      return { data: rows, error: null };
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
  const calls = { release: 0, refund: 0 };
  const control = { releaseThrows: false, refundThrows: false };
  return {
    module: {
      releaseFunds: async () => {
        calls.release++;
        if (control.releaseThrows) throw new Error('simulated Stellar failure');
        return { hash: `tx-release-${calls.release}`, ledger: 1000 + calls.release };
      },
      refund: async () => {
        calls.refund++;
        if (control.refundThrows) throw new Error('simulated Stellar failure');
        return { hash: `tx-refund-${calls.refund}`, ledger: 2000 + calls.refund };
      },
      buildLockTx: async () => { throw new Error('not used in this test'); },
      submitSignedTx: async () => { throw new Error('not used in this test'); },
      verifyTransaction: async () => ({ verified: true }),
      formatAmount: (amt) => Number(amt).toFixed(7),
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
  const escrowPath    = require.resolve('../src/services/escrow');
  const authPath      = require.resolve('../src/middleware/auth');
  const dealsPath     = require.resolve('../src/routes/deals');
  const transitionsPath = require.resolve('../src/services/dealTransitions');

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
  delete require.cache[dealsPath];
  const dealsRouter = require('../src/routes/deals');

  const app = express();
  app.use(express.json());
  app.use('/api/deals', dealsRouter);
  return app;
}

function seedDeal(store, overrides) {
  const deal = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    buyer: 'G' + 'A'.repeat(55),
    seller: 'G' + 'B'.repeat(55),
    amount: 100,
    status: 'shipped',
    shipped_at: new Date().toISOString(),
    release_tx: null,
    release_ledger: null,
    refund_tx: null,
    refund_ledger: null,
    ...overrides,
  };
  store.deals.set(deal.id, deal);
  return deal;
}

async function withServer(store, fakeEscrow, fn) {
  const app = buildApp(store, fakeEscrow);
  const server = app.listen(0);
  try {
    const port = server.address().port;
    await fn(`http://localhost:${port}/api/deals`, store);
  } finally {
    server.close();
  }
}

test('confirm: happy path calls releaseFunds exactly once and finalizes to confirmed', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = seedDeal(store, { status: 'shipped' });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'confirmed');
    assert.equal(fakeEscrow.calls.release, 1);
    assert.equal(store.deals.get(deal.id).status, 'confirmed');
  });
});

test('confirm: crash after Stellar success (release_tx stored, status stuck at confirming) does not re-call releaseFunds on retry', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  // Simulates: releaseFunds succeeded and release_tx was persisted, but the
  // process died before the final status write flipped it to 'confirmed'.
  const deal = seedDeal(store, {
    status: 'confirming',
    release_tx: 'tx-already-sent-before-crash',
    release_ledger: 999,
  });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'confirmed');
    assert.equal(body.tx_hash, 'tx-already-sent-before-crash', 'must reuse the stored hash, not mint a new payment');
    assert.equal(fakeEscrow.calls.release, 0, 'releaseFunds must NOT be called again — this is the double-spend guard');
    assert.equal(store.deals.get(deal.id).status, 'confirmed');
  });
});

test('confirm: second call while still confirming with no release_tx yet is blocked, not retried', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  // Simulates a second request landing after the first has already flipped
  // status to 'confirming' but before Stellar has responded at all.
  const deal = seedDeal(store, { status: 'confirming', release_tx: null });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(fakeEscrow.calls.release, 0, 'a blocked concurrent call must never reach Stellar');
  });
});

test('confirm: repeated calls after full completion never call releaseFunds again', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = seedDeal(store, { status: 'confirmed', release_tx: 'tx-final' });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.tx_hash, 'tx-final');
    assert.equal(fakeEscrow.calls.release, 0);
  });
});

test('cancel: crash after refund success does not re-call refund on retry', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = seedDeal(store, {
    status: 'cancelling',
    refund_tx: 'tx-refund-already-sent',
    refund_ledger: 555,
  });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.tx_hash, 'tx-refund-already-sent');
    assert.equal(fakeEscrow.calls.refund, 0, 'refund must NOT be called again — this is the double-refund guard');
    assert.equal(store.deals.get(deal.id).status, 'cancelled');
  });
});

test('cancel: second call while still cancelling with no refund_tx yet is blocked, not retried', async () => {
  const store = { deals: new Map(), transitions: [] };
  const fakeEscrow = makeFakeEscrow();
  const deal = seedDeal(store, { status: 'cancelling', refund_tx: null });

  await withServer(store, fakeEscrow, async (base) => {
    const res = await fetch(`${base}/${deal.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-wallet': deal.buyer }, body: '{}',
    });
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body));
    assert.equal(fakeEscrow.calls.refund, 0);
  });
});
