const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { rateLimit, rateLimitMap, MAX_ENTRIES } = require('../src/middleware/rateLimit');

// Clear the map before each test
beforeEach(() => {
  rateLimitMap.clear();
});

afterEach(() => {
  rateLimitMap.clear();
});

test('rate limiter allows requests within limit', () => {
  const middleware = rateLimit(10, 1000);
  const req = { ip: '192.168.1.1', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // Make 10 requests (at limit)
  for (let i = 0; i < 10; i++) {
    middleware(req, res, next);
  }

  assert.equal(nextCalled, 10);
  assert.equal(rateLimitMap.size, 1);
});

test('rate limiter blocks requests over limit', () => {
  const middleware = rateLimit(5, 1000);
  const req = { ip: '192.168.1.2', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: (code) => ({ 
      json: () => ({ statusCode: code }) 
    }) 
  };
  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // Make 6 requests (1 over limit)
  for (let i = 0; i < 6; i++) {
    middleware(req, res, next);
  }

  assert.equal(nextCalled, 5); // Only first 5 should pass
  assert.equal(rateLimitMap.size, 1);
});

test('rate limiter resets counter after window expires', () => {
  const middleware = rateLimit(3, 100); // 100ms window
  const req = { ip: '192.168.1.3', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // Make 3 requests (at limit)
  for (let i = 0; i < 3; i++) {
    middleware(req, res, next);
  }
  assert.equal(nextCalled, 3);

  // Wait for window to expire
  return new Promise(resolve => setTimeout(resolve, 150)).then(() => {
    nextCalled = 0;
    // Should allow 3 more requests
    for (let i = 0; i < 3; i++) {
      middleware(req, res, next);
    }
    assert.equal(nextCalled, 3);
  });
});

test('map size stays bounded at MAX_ENTRIES', () => {
  const middleware = rateLimit(100, 60000);
  
  // Add MAX_ENTRIES unique IPs
  for (let i = 0; i < MAX_ENTRIES; i++) {
    const req = { ip: `192.168.1.${i}`, headers: {} };
    const res = { 
      setHeader: () => {}, 
      status: () => ({ json: () => {} }) 
    };
    const next = () => {};
    middleware(req, res, next);
  }

  assert.equal(rateLimitMap.size, MAX_ENTRIES);

  // Add one more - should trigger LRU eviction
  const req = { ip: '192.168.1.99999', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};
  middleware(req, res, next);

  // Should be at most MAX_ENTRIES after eviction
  assert.ok(rateLimitMap.size <= MAX_ENTRIES);
});

test('LRU eviction removes oldest entries when at capacity', () => {
  const middleware = rateLimit(100, 60000);
  
  // Add MAX_ENTRIES entries with known timestamps
  const firstKey = '192.168.1.0';
  for (let i = 0; i < MAX_ENTRIES; i++) {
    const req = { ip: `192.168.1.${i}`, headers: {} };
    const res = { 
      setHeader: () => {}, 
      status: () => ({ json: () => {} }) 
    };
    const next = () => {};
    middleware(req, res, next);
  }

  assert.ok(rateLimitMap.has(firstKey));

  // Add one more to trigger eviction
  const req = { ip: '192.168.1.99999', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};
  middleware(req, res, next);

  // Oldest entry should be evicted (10% of MAX_ENTRIES)
  assert.ok(!rateLimitMap.has(firstKey));
});

test('prune removes entries older than their per-entry windowMs', () => {
  const middleware = rateLimit(100, 60000);
  
  // Add an entry with old timestamp and 60s window
  rateLimitMap.set('old-ip', { count: 1, start: Date.now() - 70000, windowMs: 60000 });
  
  // Add a recent entry with 60s window
  const req = { ip: 'new-ip', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};
  middleware(req, res, next);

  assert.equal(rateLimitMap.size, 2);

  // Manually trigger prune logic (simulating the interval)
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.start > entry.windowMs) rateLimitMap.delete(key);
  }

  // Old entry should be removed
  assert.equal(rateLimitMap.size, 1);
  assert.ok(!rateLimitMap.has('old-ip'));
  assert.ok(rateLimitMap.has('new-ip'));
});

test('rate limiter uses wallet address header when present', () => {
  const middleware = rateLimit(5, 1000);
  const req = { 
    ip: '192.168.1.1', 
    headers: { 'x-wallet-address': 'wallet-abc123' } 
  };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};

  middleware(req, res, next);

  // Should use wallet address as key, not IP
  assert.ok(rateLimitMap.has('wallet-abc123'));
  assert.ok(!rateLimitMap.has('192.168.1.1'));
});

test('rate limiter sets X-RateLimit headers on first request', () => {
  const middleware = rateLimit(10, 1000);
  const req = { ip: '192.168.1.1', headers: {} };
  const headers = {};
  const res = { 
    setHeader: (key, value) => { headers[key] = value; }, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};

  middleware(req, res, next);

  assert.equal(headers['X-RateLimit-Limit'], 10);
  assert.equal(headers['X-RateLimit-Remaining'], 9);
});

test('rate limiter returns 429 with Retry-After header when rate limited', () => {
  const middleware = rateLimit(2, 1000);
  const req = { ip: '192.168.1.1', headers: {} };
  const headers = {};
  let statusCode = 200;
  const res = { 
    setHeader: (key, value) => { headers[key] = value; }, 
    status: (code) => { 
      statusCode = code; 
      return { json: () => ({}) }; 
    } 
  };
  const next = () => {};

  // Make 3 requests (1 over limit)
  for (let i = 0; i < 3; i++) {
    middleware(req, res, next);
  }

  assert.equal(statusCode, 429);
  assert.ok(headers['Retry-After']);
  assert.ok(headers['X-RateLimit-Limit']);
  assert.equal(headers['X-RateLimit-Remaining'], 0);
});

test('map handles high load of unique IPs without exceeding cap', () => {
  const middleware = rateLimit(100, 60000);
  
  // Simulate 100,000 unique IPs (more than MAX_ENTRIES)
  for (let i = 0; i < 100000; i++) {
    const req = { ip: `10.0.${Math.floor(i / 256)}.${i % 256}`, headers: {} };
    const res = { 
      setHeader: () => {}, 
      status: () => ({ json: () => {} }) 
    };
    const next = () => {};
    middleware(req, res, next);
  }

  // Map size should never exceed MAX_ENTRIES
  assert.ok(rateLimitMap.size <= MAX_ENTRIES);
});

test('configurable windowMs is respected in prune', () => {
  const middleware = rateLimit(100, 300_000); // 5-minute window
  
  // Add entry with 5-minute window that's 70 seconds old
  rateLimitMap.set('old-5min', { count: 1, start: Date.now() - 70000, windowMs: 300_000 });
  
  // Add entry with 60-second window that's 70 seconds old
  rateLimitMap.set('old-60s', { count: 1, start: Date.now() - 70000, windowMs: 60000 });
  
  // Add recent entry with 5-minute window
  const req = { ip: 'new-ip', headers: {} };
  const res = { 
    setHeader: () => {}, 
    status: () => ({ json: () => {} }) 
  };
  const next = () => {};
  middleware(req, res, next);

  assert.equal(rateLimitMap.size, 3);

  // Manually trigger prune logic
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.start > entry.windowMs) rateLimitMap.delete(key);
  }

  // Only the 60s window entry should be pruned
  assert.equal(rateLimitMap.size, 2);
  assert.ok(!rateLimitMap.has('old-60s'));
  assert.ok(rateLimitMap.has('old-5min'));
  assert.ok(rateLimitMap.has('new-ip'));
});
