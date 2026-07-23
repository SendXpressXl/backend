const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

// Covers issue #39: listing ownership on PATCH/DELETE, admin role granting,
// and the seller->buyer downgrade guard. Mounts the real users/listings
// routers with a fake in-memory Supabase and a stubbed requireAuth, so the
// actual middleware chain (attachUser, requireOwnership, the role handler)
// runs unmodified against controllable data.

class FakeQuery {
  constructor(store, table, op, payload) {
    this.store = store; this.table = table; this.op = op; this.payload = payload;
    this.filters = []; this._single = false; this._limit = null;
  }
  eq(col, val) { this.filters.push({ col, val, type: 'eq' }); return this; }
  not(col, kind, valStr) {
    const list = valStr.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
    this.filters.push({ col, type: 'not-in', list });
    return this;
  }
  limit(n) { this._limit = n; return this; }
  order() { return this; }
  select() { this._wantSelect = true; return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) { try { resolve(this._execute()); } catch (e) { reject(e); } }
  _match(rows) {
    return rows.filter(r => this.filters.every(f =>
      f.type === 'not-in' ? !f.list.includes(r[f.col]) : r[f.col] === f.val
    ));
  }
  _execute() {
    const table = this.store[this.table] ??= new Map();
    const all = Array.from(table.values());
    if (this.op === 'select') {
      let rows = this._match(all);
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this._single) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
      return { data: rows, error: null };
    }
    if (this.op === 'update') {
      const rows = this._match(all);
      if (this._single && rows.length !== 1) return { data: null, error: { message: 'no rows matched', code: 'PGRST116' } };
      for (const row of rows) Object.assign(row, this.payload);
      if (this._single) return { data: rows[0], error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'delete') {
      const rows = this._match(all);
      for (const row of rows) table.delete(row.id);
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      table.set(this.payload.id, this.payload);
      return { data: this.payload, error: null };
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
        delete: () => new FakeQuery(store, table, 'delete', null),
        insert: (row) => new FakeQuery(store, table, 'insert', row),
      };
    },
  };
}

function stubModule(resolvedPath, exportsObj) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsObj };
}

function buildApp(store) {
  const supabasePath  = require.resolve('../src/config/supabase');
  const authPath      = require.resolve('../src/middleware/auth');
  const ownershipPath = require.resolve('../src/middleware/ownership');
  const roleGuardPath = require.resolve('../src/services/roleGuard');
  const usersPath     = require.resolve('../src/routes/users');
  const listingsPath  = require.resolve('../src/routes/listings');

  stubModule(supabasePath, makeFakeSupabase(store));

  // Re-require the real auth module against the stubbed supabase so
  // attachUser/requireRole run for real, only requireAuth itself is
  // replaced (session tokens aren't the concern of this test).
  delete require.cache[authPath];
  const realAuth = require('../src/middleware/auth');
  stubModule(authPath, {
    ...realAuth,
    requireAuth: (req, res, next) => { req.wallet = req.headers['x-test-wallet']; next(); },
  });

  delete require.cache[ownershipPath];
  delete require.cache[roleGuardPath];
  delete require.cache[usersPath];
  delete require.cache[listingsPath];

  const usersRouter = require('../src/routes/users');
  const listingsRouter = require('../src/routes/listings');

  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  app.use('/api/listings', listingsRouter);
  return app;
}

async function withServer(store, fn) {
  const app = buildApp(store);
  const server = app.listen(0);
  try {
    await fn(`http://localhost:${server.address().port}`, store);
  } finally {
    server.close();
    server.closeAllConnections?.(); // drop lingering keep-alive sockets so the process can exit
  }
}

function seedUser(store, overrides) {
  store.users ??= new Map();
  const user = {
    id: overrides.id, wallet: overrides.wallet, role: 'seller', ...overrides,
  };
  store.users.set(user.id, user);
  return user;
}

function seedListing(store, overrides) {
  store.listings ??= new Map();
  const listing = {
    id: 'ee111111-1111-4111-8111-111111111111',
    seller_id: overrides.seller_id, title: 'Test listing', price: 10, status: 'active', ...overrides,
  };
  store.listings.set(listing.id, listing);
  return listing;
}

function seedDeal(store, overrides) {
  store.deals ??= new Map();
  const deal = {
    id: 'dd111111-1111-4111-8111-111111111111', seller: overrides.seller, buyer: 'GBUYER'.padEnd(56, 'A'),
    amount: 10, status: 'shipped', ...overrides,
  };
  store.deals.set(deal.id, deal);
  return deal;
}

const SELLER_ID   = 'aaaaaaaa-1111-4111-8111-111111111111';
const SELLER_WALLET = 'G' + 'S'.repeat(55);
const OTHER_ID    = 'bbbbbbbb-2222-4222-8222-222222222222';
const OTHER_WALLET  = 'G' + 'O'.repeat(55);
const ADMIN_ID    = 'cccccccc-3333-4333-8333-333333333333';
const ADMIN_WALLET  = 'G' + 'D'.repeat(55);

test('listing PATCH by a non-owner, non-admin is rejected', async () => {
  const store = {};
  seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedUser(store, { id: OTHER_ID, wallet: OTHER_WALLET, role: 'seller' });
  const listing = seedListing(store, { seller_id: SELLER_ID });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/listings/${listing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': OTHER_WALLET },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    assert.equal(res.status, 403);
    assert.equal(store.listings.get(listing.id).title, 'Test listing');
  });
});

test('listing PATCH by its owner succeeds', async () => {
  const store = {};
  seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  const listing = seedListing(store, { seller_id: SELLER_ID });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/listings/${listing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ title: 'Updated title' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.title, 'Updated title');
  });
});

test('listing DELETE by an admin succeeds even though the admin is not the owner', async () => {
  const store = {};
  seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedUser(store, { id: ADMIN_ID, wallet: ADMIN_WALLET, role: 'admin' });
  const listing = seedListing(store, { seller_id: SELLER_ID });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/listings/${listing.id}`, {
      method: 'DELETE',
      headers: { 'x-test-wallet': ADMIN_WALLET },
    });
    assert.equal(res.status, 200);
    assert.equal(store.listings.has(listing.id), false);
  });
});

test('a non-admin cannot grant themselves the admin role', async () => {
  const store = {};
  const user = seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${user.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 403);
    assert.equal(store.users.get(user.id).role, 'seller');
  });
});

test('a non-admin cannot change another user\'s role', async () => {
  const store = {};
  seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  const other = seedUser(store, { id: OTHER_ID, wallet: OTHER_WALLET, role: 'buyer' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${other.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ role: 'seller' }),
    });
    assert.equal(res.status, 403);
  });
});

test('an admin can change any user\'s role, including granting admin', async () => {
  const store = {};
  seedUser(store, { id: ADMIN_ID, wallet: ADMIN_WALLET, role: 'admin' });
  const other = seedUser(store, { id: OTHER_ID, wallet: OTHER_WALLET, role: 'buyer' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${other.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': ADMIN_WALLET },
      body: JSON.stringify({ role: 'admin' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.role, 'admin');
  });
});

test('downgrading seller to buyer is blocked while an active listing exists', async () => {
  const store = {};
  const seller = seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedListing(store, { seller_id: SELLER_ID, status: 'active' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${seller.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ role: 'buyer' }),
    });
    assert.equal(res.status, 409);
    assert.equal(store.users.get(seller.id).role, 'seller');
  });
});

test('downgrading seller to buyer is blocked while an in-progress deal exists as seller', async () => {
  const store = {};
  const seller = seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedDeal(store, { seller: SELLER_WALLET, status: 'shipped' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${seller.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ role: 'buyer' }),
    });
    assert.equal(res.status, 409);
  });
});

test('downgrading seller to buyer succeeds once obligations are resolved', async () => {
  const store = {};
  const seller = seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedDeal(store, { seller: SELLER_WALLET, status: 'confirmed' }); // resolved, non-blocking

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${seller.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': SELLER_WALLET },
      body: JSON.stringify({ role: 'buyer' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.role, 'buyer');
  });
});

test('an admin can force a seller-to-buyer downgrade despite active obligations', async () => {
  const store = {};
  seedUser(store, { id: ADMIN_ID, wallet: ADMIN_WALLET, role: 'admin' });
  const seller = seedUser(store, { id: SELLER_ID, wallet: SELLER_WALLET, role: 'seller' });
  seedListing(store, { seller_id: SELLER_ID, status: 'active' });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/users/${seller.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-wallet': ADMIN_WALLET },
      body: JSON.stringify({ role: 'buyer' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.role, 'buyer');
  });
});
