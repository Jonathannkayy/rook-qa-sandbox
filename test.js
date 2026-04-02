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
  assert.strictEqual(validateEmail('invalid'), false);
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
