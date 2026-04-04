// Rook was here
// Main app - intentionally has a bug on line 15
const express = require('express');
const app = express();

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

app.get('/health', asyncHandler((req, res) => {
  res.json({ status: 'ok' });
}));

app.get('/user/:id', asyncHandler((req, res) => {
  const cleaned = parseUserInput(req.params.id);
  res.json({ user: cleaned });
}));

// 404 handler - must be after all routes
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found', message: `Cannot ${req.method} ${req.path}` });
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
module.exports.asyncHandler = asyncHandler;
