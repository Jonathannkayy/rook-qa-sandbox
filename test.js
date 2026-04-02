const assert = require('assert');

// Basic test suite
function testParseUserInput() {
  const { parseUserInput } = require('./index');
  assert.strictEqual(parseUserInput('Hello'), 'hello');
  assert.strictEqual(parseUserInput(' World '), 'world');
  assert.strictEqual(parseUserInput(null), '');
  assert.strictEqual(parseUserInput(undefined), '');
  assert.strictEqual(parseUserInput(''), '');
  console.log('PASS: parseUserInput');
}

function testValidateEmail() {
  const { validateEmail } = require('./index');
  assert.strictEqual(validateEmail('test@example.com'), true);
  assert.strictEqual(validateEmail('USER.name+tag@example.co.uk'), true);
  assert.strictEqual(validateEmail(' invalid@example.com '), true);
  assert.strictEqual(validateEmail('invalid'), false);
  assert.strictEqual(validateEmail('foo@'), false);
  assert.strictEqual(validateEmail('@bar.com'), false);
  assert.strictEqual(validateEmail('foo@@bar.com'), false);
  assert.strictEqual(validateEmail('foo bar@example.com'), false);
  assert.strictEqual(validateEmail('foo@localhost'), false);
  assert.strictEqual(validateEmail('foo@.com'), false);
  assert.strictEqual(validateEmail(''), false);
  assert.strictEqual(validateEmail(null), false);
  assert.strictEqual(validateEmail(undefined), false);
  console.log('PASS: validateEmail');
}

try {
  testParseUserInput();
  testValidateEmail();
  console.log('All tests passed');
} catch(e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
