// Rook was here
// Main app - intentionally has a bug on line 15
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();

app.use(express.json());

// Metrics tracking
const startTime = Date.now();
let requestCount = 0;
let totalResponseTime = 0;
const bookmarks = [];
let nextBookmarkId = 1;
const searchCache = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '1h';

const users = [
  {
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('password123', 10),
    email: 'admin@example.com',
    role: 'admin'
  },
  {
    id: 2,
    username: 'user',
    password: bcrypt.hashSync('userpass', 10),
    email: 'user@example.com',
    role: 'user'
  }
];

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

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json(createErrorResponse(401, 'Authentication required', 'AUTH_REQUIRED'));
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json(createErrorResponse(403, 'Invalid or expired token', 'INVALID_TOKEN'));
  }
}

const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
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
  const normalized = email.trim();
  if (!normalized || normalized.length > 254) return false;
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  return emailRegex.test(normalized);
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

app.get('/version-info', asyncHandler((req, res) => {
  const { name, version } = require('./package.json');
  res.json({ name, version });
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

app.post('/bookmarks', authenticateToken, asyncHandler((req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json(createErrorResponse(400, 'Request body is required', 'BAD_REQUEST'));
  }

  const { url, title } = req.body;
  const errors = {};

  if (typeof url !== 'string' || url.trim().length === 0) {
    errors.url = 'URL must be a non-empty string';
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.title = 'Title must be a non-empty string';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json(createErrorResponse(400, 'Validation failed', 'VALIDATION_ERROR', { errors }));
  }

  const bookmark = {
    id: nextBookmarkId++,
    url: url.trim(),
    title: title.trim(),
    created_at: new Date().toISOString()
  };
  bookmarks.push(bookmark);
  res.status(201).json(bookmark);
}));

app.get('/bookmarks', authenticateToken, asyncHandler((req, res) => {
  res.json(bookmarks);
}));

function invalidateSearchCache() {
  searchCache.clear();
}

app.get('/search', authenticateToken, asyncHandler((req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) {
    return res.status(400).json(createErrorResponse(400, 'Query parameter q is required', 'BAD_REQUEST'));
  }

  if (searchCache.has(q)) {
    return res.json(searchCache.get(q));
  }

  const results = bookmarks.filter(b =>
    b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
  );
  searchCache.set(q, results);
  res.json(results);
}));

app.delete('/bookmarks/:id', authenticateToken, asyncHandler((req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json(createErrorResponse(400, 'Invalid bookmark ID', 'BAD_REQUEST'));
  }

  const index = bookmarks.findIndex(b => b.id === id);
  if (index === -1) {
    return res.status(404).json(createErrorResponse(404, 'Bookmark not found', 'NOT_FOUND'));
  }

  bookmarks.splice(index, 1);
  invalidateSearchCache();
  res.json({ deleted: true, id });
}));

app.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json(createErrorResponse(400, 'Username and password are required', 'BAD_REQUEST'));
  }

  const user = users.find(existingUser => existingUser.username === username);
  if (!user) {
    return res.status(401).json(createErrorResponse(401, 'Invalid credentials', 'INVALID_CREDENTIALS'));
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return res.status(401).json(createErrorResponse(401, 'Invalid credentials', 'INVALID_CREDENTIALS'));
  }

  const userPayload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  };

  const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ token, user: userPayload });
}));

app.get('/me', authenticateToken, asyncHandler((req, res) => {
  res.json({ user: req.user });
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

app.get('/detach-test', asyncHandler((req, res) => {
  res.json({ detached: true, pty: true });
}));

app.get('/manual-test', asyncHandler((req, res) => {
  res.json({ manual: true });
}));

app.delete('/cache', asyncHandler((req, res) => {
  requestCount = 0;
  totalResponseTime = 0;
  res.json({ cleared: true });
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
module.exports.authenticateToken = authenticateToken;
module.exports.users = users;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.bookmarks = bookmarks;
module.exports.searchCache = searchCache;
