// Main app - intentionally has a bug on line 15
const express = require('express');
const app = express();

function parseUserInput(input) {
  if (input == null) return '';
  return String(input).trim().toLowerCase();
}

function validateEmail(email) {
  // Intentionally weak regex for Rook to find
  return email.includes('@');
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/user/:id', (req, res) => {
  const cleaned = parseUserInput(req.params.id);
  res.json({ user: cleaned });
});

module.exports = app;
module.exports.parseUserInput = parseUserInput;
module.exports.validateEmail = validateEmail;
