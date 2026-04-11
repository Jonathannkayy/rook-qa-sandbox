'use strict';

/**
 * Comprehensive tests for the Redis-backed sliding window rate limiter.
 *
 * Uses an in-memory mock Redis client to avoid requiring a running Redis instance.
 * Tests cover: basic limiting, sliding window behavior, custom options,
 * key generation, skip logic, headers, fail-open behavior, edge cases.
 *
 * Run: node test-rate-limiter.js
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const createRateLimiter = require('./middleware/rateLimiter');

// ---------------------------------------------------------------------------
// Mock Redis Client — mimics ioredis sorted set commands in memory
// ---------------------------------------------------------------------------

class MockRedis {
  constructor() {
    this.data = new Map();    // key -> [{ score, member }]
    this.expiries = new Map();
    this.failMode = false;    // set to true to simulate Redis errors
  }

  _getSet(key) {
    if (!this.data.has(key)) {
      this.data.set(key, []);
    }
    return this.data.get(key);
  }

  async zremrangebyscore(key, min, max) {
    if (this.failMode) throw new Error('Redis connection refused');
    const set = this._getSet(key);
    const minVal = min === '-inf' ? -Infinity : Number(min);
    const maxVal = max === '+inf' ? Infinity : Number(max);
    const before = set.length;
    const filtered = set.filter(e => !(e.score >= minVal && e.score <= maxVal));
    this.data.set(key, filtered);
    return before - filtered.length;
  }

  async zcard(key) {
    if (this.failMode) throw new Error('Redis connection refused');
    return this._getSet(key).length;
  }

  async zadd(key, score, member) {
    if (this.failMode) throw new Error('Redis connection refused');
    this._getSet(key).push({ score: Number(score), member });
    return 1;
  }

  async zrem(key, member) {
    if (this.failMode) throw new Error('Redis connection refused');
    const set = this._getSet(key);
    const idx = set.findIndex(e => e.member === member);
    if (idx >= 0) {
      set.splice(idx, 1);
      return 1;
    }
    return 0;
  }

  async zrange(key, start, stop, ...args) {
    if (this.failMode) throw new Error('Redis connection refused');
    const set = this._getSet(key).sort((a, b) => a.score - b.score);
    const sliced = set.slice(start, stop + 1);
    const withScores = args.includes('WITHSCORES');
    const result = [];
    for (const entry of sliced) {
      result.push(entry.member);
      if (withScores) result.push(String(entry.score));
    }
    return result;
  }

  async pexpire(key, ms) {
    if (this.failMode) throw new Error('Redis connection refused');
    this.expiries.set(key, ms);
    return 1;
  }

  /**
   * ioredis multi() returns a chainable pipeline.
   * Calling exec() returns an array of [err, result] pairs.
   */
  multi() {
    const commands = [];
    const self = this;

    const chain = {
      zremrangebyscore(key, min, max) {
        commands.push(() => self.zremrangebyscore(key, min, max));
        return chain;
      },
      zcard(key) {
        commands.push(() => self.zcard(key));
        return chain;
      },
      zadd(key, score, member) {
        commands.push(() => self.zadd(key, score, member));
        return chain;
      },
      pexpire(key, ms) {
        commands.push(() => self.pexpire(key, ms));
        return chain;
      },
      async exec() {
        if (self.failMode) throw new Error('Redis connection refused');
        const results = [];
        for (const cmd of commands) {
          try {
            const val = await cmd();
            results.push([null, val]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };

    return chain;
  }

  reset() {
    this.data.clear();
    this.expiries.clear();
    this.failMode = false;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestApp(redis, opts = {}) {
  const app = express();
  const limiter = createRateLimiter(redis, opts);
  app.use(limiter);
  app.get('/test', (req, res) => res.json({ ok: true }));
  app.post('/test', (req, res) => res.json({ ok: true }));
  return app;
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: path || '/test',
      method: 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        await fn(port);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testRequiresRedisClient() {
  assert.throws(
    () => createRateLimiter(null),
    /redisClient is required/,
    'Must throw when no Redis client provided'
  );
  assert.throws(
    () => createRateLimiter(undefined),
    /redisClient is required/
  );
  console.log('PASS: requires Redis client');
}

async function testInvalidWindowMs() {
  const redis = new MockRedis();
  assert.throws(
    () => createRateLimiter(redis, { windowMs: 0 }),
    /windowMs must be a positive number/
  );
  assert.throws(
    () => createRateLimiter(redis, { windowMs: -1000 }),
    /windowMs must be a positive number/
  );
  assert.throws(
    () => createRateLimiter(redis, { windowMs: 'invalid' }),
    /windowMs must be a positive number/
  );
  console.log('PASS: validates windowMs');
}

async function testInvalidMaxRequests() {
  const redis = new MockRedis();
  assert.throws(
    () => createRateLimiter(redis, { maxRequests: 0 }),
    /maxRequests must be a positive integer/
  );
  assert.throws(
    () => createRateLimiter(redis, { maxRequests: -5 }),
    /maxRequests must be a positive integer/
  );
  assert.throws(
    () => createRateLimiter(redis, { maxRequests: 3.5 }),
    /maxRequests must be a positive integer/
  );
  console.log('PASS: validates maxRequests');
}

async function testAllowsRequestsUnderLimit() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 5, windowMs: 60000 });

  await withServer(app, async (port) => {
    for (let i = 0; i < 5; i++) {
      const resp = await get(port);
      assert.strictEqual(resp.status, 200, `Request ${i + 1} should be allowed`);
      assert.strictEqual(resp.body.ok, true);
    }
  });
  console.log('PASS: allows requests under limit');
}

async function testBlocksRequestsOverLimit() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 3, windowMs: 60000 });

  await withServer(app, async (port) => {
    // Use up the limit
    for (let i = 0; i < 3; i++) {
      const resp = await get(port);
      assert.strictEqual(resp.status, 200);
    }

    // Next request should be blocked
    const blocked = await get(port);
    assert.strictEqual(blocked.status, 429, 'Must return 429 when over limit');
    assert.strictEqual(blocked.body.error, 'Too many requests, please try again later');
    assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
    assert.strictEqual(blocked.body.status, 429);
    assert.ok(typeof blocked.body.retryAfter === 'number', 'Must include retryAfter');
  });
  console.log('PASS: blocks requests over limit');
}

async function testSetsRateLimitHeaders() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 10, windowMs: 60000 });

  await withServer(app, async (port) => {
    const resp = await get(port);
    assert.strictEqual(resp.status, 200);

    assert.strictEqual(resp.headers['ratelimit-limit'], '10');
    assert.strictEqual(resp.headers['ratelimit-remaining'], '9');
    assert.ok(resp.headers['ratelimit-reset'], 'Must have RateLimit-Reset header');
    assert.ok(resp.headers['ratelimit-policy'], 'Must have RateLimit-Policy header');
    assert.ok(resp.headers['ratelimit-policy'].includes('10;w=60'));
  });
  console.log('PASS: sets rate limit headers');
}

async function testHeadersDecrementCorrectly() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 3, windowMs: 60000 });

  await withServer(app, async (port) => {
    const r1 = await get(port);
    assert.strictEqual(r1.headers['ratelimit-remaining'], '2');

    const r2 = await get(port);
    assert.strictEqual(r2.headers['ratelimit-remaining'], '1');

    const r3 = await get(port);
    assert.strictEqual(r3.headers['ratelimit-remaining'], '0');

    // Blocked request should also have headers
    const r4 = await get(port);
    assert.strictEqual(r4.status, 429);
    assert.strictEqual(r4.headers['ratelimit-remaining'], '0');
    assert.ok(r4.headers['retry-after'], 'Blocked response must have Retry-After');
  });
  console.log('PASS: headers decrement correctly');
}

async function testDisableHeaders() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 5, windowMs: 60000, headers: false });

  await withServer(app, async (port) => {
    const resp = await get(port);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(resp.headers['ratelimit-limit'], undefined);
    assert.strictEqual(resp.headers['ratelimit-remaining'], undefined);
  });
  console.log('PASS: disable headers');
}

async function testCustomKeyGenerator() {
  const redis = new MockRedis();
  // Key by a custom header instead of IP
  const app = createTestApp(redis, {
    maxRequests: 2,
    windowMs: 60000,
    keyGenerator: (req) => req.headers['x-api-key'] || 'anonymous',
  });

  await withServer(app, async (port) => {
    // Client A
    const a1 = await get(port, '/test', { 'x-api-key': 'client-a' });
    assert.strictEqual(a1.status, 200);
    const a2 = await get(port, '/test', { 'x-api-key': 'client-a' });
    assert.strictEqual(a2.status, 200);
    const a3 = await get(port, '/test', { 'x-api-key': 'client-a' });
    assert.strictEqual(a3.status, 429, 'Client A should be blocked');

    // Client B should still be allowed (separate key)
    const b1 = await get(port, '/test', { 'x-api-key': 'client-b' });
    assert.strictEqual(b1.status, 200, 'Client B should not be affected by Client A');
  });
  console.log('PASS: custom key generator');
}

async function testSkipFunction() {
  const redis = new MockRedis();
  const app = createTestApp(redis, {
    maxRequests: 1,
    windowMs: 60000,
    skip: (req) => req.url === '/test' && req.headers['x-bypass'] === 'true',
  });

  await withServer(app, async (port) => {
    // Use up the limit
    const r1 = await get(port);
    assert.strictEqual(r1.status, 200);
    const r2 = await get(port);
    assert.strictEqual(r2.status, 429);

    // With skip header, should bypass rate limiting
    const r3 = await get(port, '/test', { 'x-bypass': 'true' });
    assert.strictEqual(r3.status, 200, 'Skipped request should pass');
  });
  console.log('PASS: skip function');
}

async function testOnLimitReachedCallback() {
  const redis = new MockRedis();
  let callbackCalled = false;
  let callbackReq = null;

  const app = createTestApp(redis, {
    maxRequests: 1,
    windowMs: 60000,
    onLimitReached: (req) => {
      callbackCalled = true;
      callbackReq = req;
    },
  });

  await withServer(app, async (port) => {
    await get(port);
    assert.strictEqual(callbackCalled, false, 'Callback should not fire under limit');

    await get(port);
    assert.strictEqual(callbackCalled, true, 'Callback should fire when limit reached');
    assert.ok(callbackReq, 'Callback should receive the request object');
  });
  console.log('PASS: onLimitReached callback');
}

async function testCustomMessage() {
  const redis = new MockRedis();
  const customMsg = 'Slow down, partner!';
  const app = createTestApp(redis, {
    maxRequests: 1,
    windowMs: 60000,
    message: customMsg,
  });

  await withServer(app, async (port) => {
    await get(port);
    const blocked = await get(port);
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.error, customMsg);
  });
  console.log('PASS: custom message');
}

async function testCustomStatusCode() {
  const redis = new MockRedis();
  const app = createTestApp(redis, {
    maxRequests: 1,
    windowMs: 60000,
    statusCode: 503,
  });

  await withServer(app, async (port) => {
    await get(port);
    const blocked = await get(port);
    assert.strictEqual(blocked.status, 503);
    assert.strictEqual(blocked.body.status, 503);
  });
  console.log('PASS: custom status code');
}

async function testCustomKeyPrefix() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis, { keyPrefix: 'api:v2:' });
  const fakeReq = { ip: '10.0.0.1' };
  const key = middleware.getKey(fakeReq);
  assert.ok(key.startsWith('api:v2:'), `Key should start with custom prefix, got: ${key}`);
  assert.ok(key.includes('10.0.0.1'), 'Key should include the IP');
  console.log('PASS: custom key prefix');
}

async function testDefaultKeyUsesIp() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis, {});
  const fakeReq = { ip: '192.168.1.100' };
  const key = middleware.getKey(fakeReq);
  assert.strictEqual(key, 'rl:192.168.1.100');
  console.log('PASS: default key uses IP');
}

async function testKeyFallbackToRemoteAddress() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis, {});
  const fakeReq = { connection: { remoteAddress: '10.0.0.5' } };
  const key = middleware.getKey(fakeReq);
  assert.strictEqual(key, 'rl:10.0.0.5');
  console.log('PASS: key fallback to remoteAddress');
}

async function testKeyFallbackToDefault() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis, {});
  const fakeReq = {};
  const key = middleware.getKey(fakeReq);
  assert.strictEqual(key, 'rl:127.0.0.1');
  console.log('PASS: key fallback to default 127.0.0.1');
}

async function testFailOpenOnRedisError() {
  const redis = new MockRedis();
  redis.failMode = true;

  const app = createTestApp(redis, { maxRequests: 1, windowMs: 60000 });

  await withServer(app, async (port) => {
    // Even though Redis is "down", requests should pass through
    const r1 = await get(port);
    assert.strictEqual(r1.status, 200, 'Must fail open when Redis is down');
    const r2 = await get(port);
    assert.strictEqual(r2.status, 200, 'Must continue to fail open');
  });
  console.log('PASS: fail open on Redis error');
}

async function testSlidingWindowExpiry() {
  const redis = new MockRedis();

  // Simulate a window where old entries exist
  const key = 'rl:::ffff:127.0.0.1';
  const now = Date.now();
  const windowMs = 10000; // 10 seconds

  // Add entries that are older than the window (should be cleaned up)
  redis._getSet(key).push({ score: now - 20000, member: 'old1' });
  redis._getSet(key).push({ score: now - 15000, member: 'old2' });

  const app = createTestApp(redis, { maxRequests: 2, windowMs });

  await withServer(app, async (port) => {
    // Old entries should be cleaned up, so both requests should pass
    const r1 = await get(port);
    assert.strictEqual(r1.status, 200, 'Should allow after old entries cleaned up');
    const r2 = await get(port);
    assert.strictEqual(r2.status, 200, 'Should allow second request');
  });
  console.log('PASS: sliding window cleans up expired entries');
}

async function testIsolationBetweenClients() {
  const redis = new MockRedis();
  const app = express();
  const limiter = createRateLimiter(redis, {
    maxRequests: 2,
    windowMs: 60000,
    keyGenerator: (req) => req.headers['x-client-id'] || 'default',
  });
  app.use(limiter);
  app.get('/test', (req, res) => res.json({ ok: true }));

  await withServer(app, async (port) => {
    // Client 1 uses up its limit
    await get(port, '/test', { 'x-client-id': 'c1' });
    await get(port, '/test', { 'x-client-id': 'c1' });
    const c1blocked = await get(port, '/test', { 'x-client-id': 'c1' });
    assert.strictEqual(c1blocked.status, 429);

    // Client 2 should be completely unaffected
    const c2r1 = await get(port, '/test', { 'x-client-id': 'c2' });
    assert.strictEqual(c2r1.status, 200);
    const c2r2 = await get(port, '/test', { 'x-client-id': 'c2' });
    assert.strictEqual(c2r2.status, 200);
    const c2blocked = await get(port, '/test', { 'x-client-id': 'c2' });
    assert.strictEqual(c2blocked.status, 429);
  });
  console.log('PASS: isolation between clients');
}

async function testExposedOptions() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis, {
    maxRequests: 42,
    windowMs: 30000,
    keyPrefix: 'custom:',
  });
  assert.strictEqual(middleware.options.maxRequests, 42);
  assert.strictEqual(middleware.options.windowMs, 30000);
  assert.strictEqual(middleware.options.keyPrefix, 'custom:');
  console.log('PASS: exposes options for inspection');
}

async function testRedisKeyExpiry() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 10, windowMs: 5000 });

  await withServer(app, async (port) => {
    await get(port);
    // Check that pexpire was called with the right TTL
    const entries = Array.from(redis.expiries.entries());
    assert.ok(entries.length > 0, 'Should set expiry on Redis keys');
    const [, ttl] = entries[0];
    assert.strictEqual(ttl, 5000, 'TTL should match windowMs');
  });
  console.log('PASS: sets Redis key expiry matching windowMs');
}

async function testResponseBody429Shape() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 1, windowMs: 60000 });

  await withServer(app, async (port) => {
    await get(port);
    const blocked = await get(port);

    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(typeof blocked.body.error, 'string');
    assert.strictEqual(typeof blocked.body.status, 'number');
    assert.strictEqual(typeof blocked.body.code, 'string');
    assert.strictEqual(typeof blocked.body.retryAfter, 'number');
    assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
    assert.ok(blocked.body.retryAfter > 0, 'retryAfter must be positive');
  });
  console.log('PASS: 429 response body shape');
}

async function testDefaultOptions() {
  const { DEFAULT_OPTIONS } = require('./middleware/rateLimiter');
  assert.strictEqual(DEFAULT_OPTIONS.windowMs, 60000);
  assert.strictEqual(DEFAULT_OPTIONS.maxRequests, 100);
  assert.strictEqual(DEFAULT_OPTIONS.keyPrefix, 'rl:');
  assert.strictEqual(DEFAULT_OPTIONS.statusCode, 429);
  assert.strictEqual(DEFAULT_OPTIONS.headers, true);
  console.log('PASS: default options exported correctly');
}

async function testMiddlewareIsFunction() {
  const redis = new MockRedis();
  const middleware = createRateLimiter(redis);
  assert.strictEqual(typeof middleware, 'function');
  // Express middleware should accept 3 params (req, res, next)
  assert.strictEqual(middleware.length, 3);
  console.log('PASS: middleware is a proper Express middleware function');
}

async function testMultipleBlockedRequestsStayBlocked() {
  const redis = new MockRedis();
  const app = createTestApp(redis, { maxRequests: 1, windowMs: 60000 });

  await withServer(app, async (port) => {
    await get(port); // Use the one allowed request
    for (let i = 0; i < 5; i++) {
      const resp = await get(port);
      assert.strictEqual(resp.status, 429, `Blocked request ${i + 1} should remain 429`);
    }
  });
  console.log('PASS: multiple blocked requests stay blocked');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const tests = [
  testRequiresRedisClient,
  testInvalidWindowMs,
  testInvalidMaxRequests,
  testAllowsRequestsUnderLimit,
  testBlocksRequestsOverLimit,
  testSetsRateLimitHeaders,
  testHeadersDecrementCorrectly,
  testDisableHeaders,
  testCustomKeyGenerator,
  testSkipFunction,
  testOnLimitReachedCallback,
  testCustomMessage,
  testCustomStatusCode,
  testCustomKeyPrefix,
  testDefaultKeyUsesIp,
  testKeyFallbackToRemoteAddress,
  testKeyFallbackToDefault,
  testFailOpenOnRedisError,
  testSlidingWindowExpiry,
  testIsolationBetweenClients,
  testExposedOptions,
  testRedisKeyExpiry,
  testResponseBody429Shape,
  testDefaultOptions,
  testMiddlewareIsFunction,
  testMultipleBlockedRequestsStayBlocked,
];

(async () => {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      failed++;
      failures.push({ name: test.name, error: err });
      console.error(`FAIL: ${test.name} — ${err.message}`);
    }
  }

  process.env.NODE_ENV = origEnv;

  console.log(`\n--- Rate Limiter Tests ---`);
  console.log(`Total: ${tests.length}  Passed: ${passed}  Failed: ${failed}`);

  if (failures.length > 0) {
    console.error('\nFailure details:');
    for (const f of failures) {
      console.error(`\n  ${f.name}:`);
      console.error(`    ${f.error.stack || f.error.message}`);
    }
    process.exit(1);
  }
})();
