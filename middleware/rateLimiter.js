'use strict';

/**
 * Redis-backed sliding window rate limiter middleware.
 *
 * Uses Redis sorted sets to implement a precise sliding window algorithm.
 * Each request is stored as a member with the current timestamp as its score.
 * On each request we:
 *   1. Remove entries older than the window
 *   2. Count remaining entries
 *   3. If under the limit, add the new request
 *   4. Set a TTL on the key so Redis cleans up idle clients
 *
 * All four operations run inside a single Redis pipeline (MULTI/EXEC)
 * for atomicity and minimal round-trips.
 *
 * @see https://github.com/your-org/repo/issues/30
 */

const crypto = require('crypto');

const DEFAULT_OPTIONS = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 100,           // requests per window
  keyPrefix: 'rl:',           // Redis key prefix
  message: 'Too many requests, please try again later',
  statusCode: 429,
  headers: true,              // send RateLimit-* headers
  keyGenerator: null,         // custom key generator fn(req) => string
  skip: null,                 // fn(req) => boolean — skip rate limiting
  onLimitReached: null,       // fn(req, res, optionsCopy) — called when limit hit
};

/**
 * Create a sliding-window rate limiter middleware.
 *
 * @param {object} redisClient  - An ioredis-compatible client instance
 * @param {object} [opts]       - Configuration overrides
 * @returns {Function} Express middleware (req, res, next)
 */
function createRateLimiter(redisClient, opts = {}) {
  if (!redisClient) {
    throw new Error('redisClient is required for the sliding window rate limiter');
  }

  const options = Object.assign({}, DEFAULT_OPTIONS, opts);
  const { windowMs, maxRequests, keyPrefix, statusCode, headers, message } = options;

  if (typeof windowMs !== 'number' || windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }
  if (typeof maxRequests !== 'number' || maxRequests <= 0 || !Number.isInteger(maxRequests)) {
    throw new Error('maxRequests must be a positive integer');
  }

  /**
   * Derive the rate-limit key for a given request.
   */
  function getKey(req) {
    if (typeof options.keyGenerator === 'function') {
      return keyPrefix + options.keyGenerator(req);
    }
    // Default: client IP (Express trust proxy aware)
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    return keyPrefix + ip;
  }

  /**
   * Sliding window check + record using a Redis pipeline.
   * Returns { allowed: boolean, current: number, remaining: number, resetMs: number }
   */
  async function slidingWindowCheck(key, now) {
    const windowStart = now - windowMs;
    const member = `${now}:${crypto.randomBytes(4).toString('hex')}`;
    const ttlSeconds = Math.ceil(windowMs / 1000);

    const pipeline = redisClient.multi();
    // 1. Remove entries outside the window
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    // 2. Count entries in the current window
    pipeline.zcard(key);
    // 3. Add the current request (we may remove it if over limit)
    pipeline.zadd(key, now, member);
    // 4. Set expiry so idle keys are cleaned up
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();

    // results is [[err, val], ...] for ioredis
    const currentCount = results[1][1]; // zcard result BEFORE adding

    if (currentCount >= maxRequests) {
      // Over limit — remove the entry we just added
      await redisClient.zrem(key, member);

      // Find when the oldest entry expires to calculate reset time
      const oldest = await redisClient.zrange(key, 0, 0, 'WITHSCORES');
      const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now;
      const resetMs = oldestScore + windowMs;

      return {
        allowed: false,
        current: currentCount,
        remaining: 0,
        resetMs,
      };
    }

    return {
      allowed: true,
      current: currentCount + 1,
      remaining: maxRequests - (currentCount + 1),
      resetMs: now + windowMs,
    };
  }

  /**
   * The actual Express middleware.
   */
  async function rateLimiterMiddleware(req, res, next) {
    // Allow skipping certain requests
    if (typeof options.skip === 'function' && options.skip(req)) {
      return next();
    }

    const key = getKey(req);
    const now = Date.now();

    let result;
    try {
      result = await slidingWindowCheck(key, now);
    } catch (err) {
      // If Redis is down, fail open — allow the request through
      if (process.env.NODE_ENV !== 'test') {
        console.error('[RateLimiter] Redis error, failing open:', err.message);
      }
      return next();
    }

    // Set standard rate limit headers (draft-7 style)
    if (headers) {
      const resetSeconds = Math.max(0, Math.ceil((result.resetMs - now) / 1000));
      res.setHeader('RateLimit-Limit', maxRequests);
      res.setHeader('RateLimit-Remaining', Math.max(0, result.remaining));
      res.setHeader('RateLimit-Reset', resetSeconds);
      res.setHeader('RateLimit-Policy', `${maxRequests};w=${Math.ceil(windowMs / 1000)}`);
    }

    if (!result.allowed) {
      if (typeof options.onLimitReached === 'function') {
        options.onLimitReached(req, res, options);
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((result.resetMs - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);

      return res.status(statusCode).json({
        error: message,
        status: statusCode,
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSeconds,
      });
    }

    next();
  }

  // Expose internals for testing
  rateLimiterMiddleware.options = options;
  rateLimiterMiddleware.getKey = getKey;

  return rateLimiterMiddleware;
}

module.exports = createRateLimiter;
module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
