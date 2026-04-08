// Rook was here
// Main app - intentionally has a bug on line 15
const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();

app.use(express.json());

// Metrics tracking
const startTime = Date.now();
let requestCount = 0;
let totalResponseTime = 0;

// Dependency checks for readiness probe
const dependencyChecks = [
  { name: 'self', check: async () => true }
];

function addDependencyCheck(name, checkFn) {
  dependencyChecks.push({ name, check: checkFn });
}

// Request logging middleware - must be first in the chain
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${req.method}] ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
}
app.use(requestLogger);

// Correlation ID middleware - assigns or propagates X-Correlation-ID on every response
const crypto = require('crypto');
function correlationId(req, res, next) {
  const id = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-ID', id);
  next();
}
app.use(correlationId);

// Request counter and response time tracking middleware
app.use((req, res, next) => {
  const start = Date.now();
  requestCount++;
  res.on('finish', () => {
    totalResponseTime += Date.now() - start;
  });
  next();
});

// Input sanitization middleware - strips HTML tags from string inputs
function sanitizeInput(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/<[^>]*>/g, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeInput(obj[key]);
      }
    }
    return sanitized;
  }
  return obj;
}

app.use((req, res, next) => {
  if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
    req.body = sanitizeInput(req.body);
  }
  next();
});

// Rate limiting middleware - 100 requests per 15 minutes per IP
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use(rateLimiter);

// Async route wrapper - catches errors and forwards to error handler
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseUserInput(input) {
  if (input == null) return '';
  return String(input).trim().toLowerCase();
}

function createErrorResponse(status, error, code, extra) {
  const body = { error, status };
  if (code) body.code = code;
  if (extra) Object.assign(body, extra);
  return body;
}

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  // Standard email regex: local@domain.tld
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(email);
}

function validateName(name) {
  return typeof name === 'string' && name.trim().length >= 2;
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

app.get('/health', asyncHandler((req, res) => {
  if (Object.keys(req.query).length > 0) {
    return res.status(400).json(createErrorResponse(400, 'Health endpoint does not accept query parameters', 'BAD_REQUEST'));
  }
  const elapsedMs = Date.now() - startTime;
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    startedAt: new Date(startTime).toISOString(),
    uptime_seconds: Math.floor(elapsedMs / 1000),
    uptime: formatUptime(elapsedMs),
    process_uptime: process.uptime(),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external
    }
  });
}));

app.get('/version', asyncHandler((req, res) => {
  const { version } = require('./package.json');
  res.json({ version });
}));

app.get('/user/:id', asyncHandler((req, res) => {
  const cleaned = parseUserInput(req.params.id);
  res.json({ user: cleaned });
}));

app.post('/validate', asyncHandler((req, res) => {
  const { email, name } = req.body || {};
  const emailValid = validateEmail(email);
  const nameValid = validateName(name);

  if (!emailValid || !nameValid) {
    return res.status(400).json(createErrorResponse(400, 'Validation failed', 'VALIDATION_ERROR', {
      errors: {
        email: emailValid ? null : 'Invalid email',
        name: nameValid ? null : 'Invalid name'
      }
    }));
  }

  res.json({ valid: true, email: parseUserInput(email), name: name.trim() });
}));

app.get('/metrics', asyncHandler((req, res) => {
  const avgResponseTime = requestCount > 0 ? Math.round(totalResponseTime / requestCount) : 0;
  res.json({
    uptime: Math.floor((Date.now() - startTime) / 1000),
    requestCount,
    avgResponseTime,
    memoryUsage: process.memoryUsage()
  });
}));

app.get('/stats', asyncHandler((req, res) => {
  res.json({
    totalRequests: requestCount,
    uptime: Math.floor((Date.now() - startTime) / 1000)
  });
}));

app.get('/worktree-verify', asyncHandler((req, res) => {
  res.json({ isolated: true });
}));

app.get('/env', asyncHandler((req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV || 'undefined',
    processVersion: process.version
  });
}));

app.get('/arch-test', asyncHandler((req, res) => {
  res.json({ architecture: 'event-bus', status: 'verified' });
}));
app.post('/comments', asyncHandler((req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json(createErrorResponse(400, 'Request body is required', 'BAD_REQUEST'));
  }

  const { text, author } = req.body;
  const errors = {};

  if (typeof text !== 'string' || text.trim().length === 0) {
    errors.text = 'Text must be a non-empty string';
  }
  if (typeof author !== 'string' || author.trim().length === 0) {
    errors.author = 'Author is required';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json(createErrorResponse(400, 'Validation failed', 'VALIDATION_ERROR', { errors }));
  }

  res.status(201).json({ text: text.trim(), author: author.trim() });
}));

app.get('/ready', asyncHandler(async (req, res) => {
  const results = await Promise.allSettled(
    dependencyChecks.map(async (dep) => {
      const ok = await dep.check();
      return { name: dep.name, ready: !!ok };
    })
  );
  const checks = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { name: dependencyChecks[i].name, ready: false, error: r.reason?.message };
  });
  const allReady = checks.every(c => c.ready);
  res.status(allReady ? 200 : 503).json({ ready: allReady, checks });
}));

app.get('/completion-test', asyncHandler((req, res) => {
  res.json({ completed: true, method: 'metadata' });
}));

app.get('/pty-fix-test', asyncHandler((req, res) => {
  res.json({ pty: 'fixed', timestamp: Date.now() });
}));

// 404 handler - must be after all routes
app.use((req, res, next) => {
  res.status(404).json(createErrorResponse(404, 'Not Found', 'NOT_FOUND', { path: req.path }));
});

// Global error handler - must be last middleware (4 params required)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  }
  res.status(statusCode).json(createErrorResponse(statusCode, message, code));
});

module.exports = app;
module.exports.parseUserInput = parseUserInput;
module.exports.validateEmail = validateEmail;
module.exports.validateName = validateName;
module.exports.asyncHandler = asyncHandler;
module.exports.requestLogger = requestLogger;
module.exports.formatUptime = formatUptime;
module.exports.getMetrics = () => ({
  uptime: Math.floor((Date.now() - startTime) / 1000),
  requestCount,
  memoryUsage: process.memoryUsage()
});
module.exports.addDependencyCheck = addDependencyCheck;
module.exports.rateLimiter = rateLimiter;
module.exports.getRequestCount = () => requestCount;
module.exports.createErrorResponse = createErrorResponse;
module.exports.correlationId = correlationId;
