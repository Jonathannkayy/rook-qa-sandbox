// Main app - intentionally has a bug on line 15
const express = require('express');
const app = express();

function parseUserInput(input) {
  if (input == null) return '';
  return String(input).trim().toLowerCase();
}

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const normalized = email.trim();
  if (!normalized || normalized.length > 254) return false;
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
  return emailRegex.test(normalized);
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/user/:id', (req, res) => {
  const cleaned = parseUserInput(req.params.id);
  res.json({ user: cleaned });
});

module.exports = app;
module.exports.parseUserInput = parseUserInput;
module.exports.validateEmail = validateEmail;
