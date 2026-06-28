const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock Supabase config module before loading the middleware
const mockSupabase = {
  from: () => ({
    upsert: async () => ({ error: null }),
    select: () => ({
      eq: () => ({
        gt: () => ({
          single: async () => ({
            data: { 
              nonce: 'sendxpress:8397a61d19b7348981e7d02847a9ab7f938d61ea8b5c4b1a8d9a0f0d2c3e4f5a', 
              expires_at: new Date(Date.now() + 100000).toISOString() 
            },
            error: null
          })
        })
      })
    }),
    delete: () => ({
      eq: async () => ({ error: null })
    })
  })
};

require.cache[require.resolve('../src/config/supabase')] = {
  id: require.resolve('../src/config/supabase'),
  filename: require.resolve('../src/config/supabase'),
  loaded: true,
  exports: mockSupabase
};

// Now load the auth middleware
const { issueChallenge } = require('../src/middleware/auth');

test('issueChallenge generates a CSPRNG-based nonce with sendxpress: prefix', async () => {
  let jsonResponse = null;
  let statusCode = 200;

  const req = {
    query: {
      wallet: 'GB3KJPLGUZMRM3SBNI644UGB6N4T3PZEXQLEJNX24K4YBNMQTRQL6BQA'
    }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await issueChallenge(req, res);

  assert.equal(statusCode, 200);
  assert.ok(jsonResponse.nonce, 'nonce must be present');
  assert.ok(jsonResponse.nonce.startsWith('sendxpress:'), 'nonce must start with sendxpress:');
  
  const hexPart = jsonResponse.nonce.split(':')[1];
  assert.equal(hexPart.length, 64, 'hex part must be 64 characters (32 bytes)');
  assert.match(hexPart, /^[0-9a-f]+$/, 'hex part must contain only hex characters');
});

test('issueChallenge returns 400 when wallet is missing', async () => {
  let jsonResponse = null;
  let statusCode = 200;

  const req = {
    query: {}
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await issueChallenge(req, res);

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.error, 'wallet required');
});
