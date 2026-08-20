const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidTxHash, getChainConfig, listSupportedChains } = require('../src/services/cctp');

describe('CCTP service', () => {
  describe('isValidTxHash', () => {
    it('accepts a valid 0x-prefixed 64-char hex hash', () => {
      const hash = '0x' + 'a'.repeat(64);
      assert.equal(isValidTxHash(hash), true);
    });

    it('rejects a hash without 0x prefix', () => {
      assert.equal(isValidTxHash('a'.repeat(64)), false);
    });

    it('rejects a hash that is too short', () => {
      assert.equal(isValidTxHash('0x' + 'a'.repeat(63)), false);
    });

    it('rejects a hash with invalid hex chars', () => {
      assert.equal(isValidTxHash('0x' + 'g'.repeat(64)), false);
    });

    it('rejects null/undefined', () => {
      assert.equal(isValidTxHash(null), false);
      assert.equal(isValidTxHash(undefined), false);
    });
  });

  describe('getChainConfig', () => {
    it('finds ethereum by name', () => {
      const chain = getChainConfig('ethereum');
      assert.ok(chain);
      assert.equal(chain.chainId, 11155111);
      assert.equal(chain.domain, 0);
    });

    it('finds chain by chain ID', () => {
      const chain = getChainConfig(84532);
      assert.ok(chain);
      assert.equal(chain.name, 'Base Sepolia');
    });

    it('returns null for unknown chain', () => {
      assert.equal(getChainConfig('polygon'), null);
      assert.equal(getChainConfig(999), null);
    });

    it('is case-insensitive', () => {
      const chain = getChainConfig('ETHEREUM');
      assert.ok(chain);
      assert.equal(chain.chainId, 11155111);
    });
  });

  describe('listSupportedChains', () => {
    it('returns all four supported chains', () => {
      const chains = listSupportedChains();
      assert.equal(chains.length, 4);
    });

    it('each chain has required fields', () => {
      const chains = listSupportedChains();
      for (const chain of chains) {
        assert.ok(chain.key, 'missing key');
        assert.ok(chain.name, 'missing name');
        assert.ok(typeof chain.chainId === 'number', 'missing chainId');
        assert.ok(typeof chain.domain === 'number', 'missing domain');
        assert.ok(chain.usdcAddress, 'missing usdcAddress');
      }
    });

    it('includes ethereum, arbitrum, base, avalanche', () => {
      const chains = listSupportedChains();
      const keys = chains.map(c => c.key);
      assert.ok(keys.includes('ethereum'));
      assert.ok(keys.includes('arbitrum'));
      assert.ok(keys.includes('base'));
      assert.ok(keys.includes('avalanche'));
    });
  });
});
