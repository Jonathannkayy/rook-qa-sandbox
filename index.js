// Rook was here
// Main app - intentionally has a bug on line 15
const express = require('express');
const app = express();

app.use(express.json());

// Metrics tracking
const startTime = Date.now();
let requestCount = 0;

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

// Request counter middleware
app.use((req, res, next) => {
  requestCount++;
  next();
});

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
    return res.status(400).json({ error: 'Health endpoint does not accept query parameters' });
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
    return res.status(400).json({
      valid: false,
      errors: {
        email: emailValid ? null : 'Invalid email',
        name: nameValid ? null : 'Invalid name'
      }
    });
  }

  res.json({ valid: true, email: parseUserInput(email), name: name.trim() });
}));

app.get('/metrics', asyncHandler((req, res) => {
  res.json({
    uptime: Math.floor((Date.now() - startTime) / 1000),
    requestCount,
    memoryUsage: process.memoryUsage()
  });
}));

app.get('/worktree-verify', asyncHandler((req, res) => {
  res.json({ isolated: true });
}));

app.post('/comments', asyncHandler((req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body is required' });
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
    return res.status(400).json({ error: 'Validation failed', errors });
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

// 404 handler - must be after all routes
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Global error handler - must be last middleware (4 params required)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  }
  res.status(statusCode).json({ error: message });
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
