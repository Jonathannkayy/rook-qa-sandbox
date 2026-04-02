const assert = require('assert');

// Basic test suite
function testParseUserInput() {
  // This test will fail because of the null bug
  const { parseUserInput } = require('./index');
  assert.strictEqual(parseUserInput('Hello'), 'hello');
  assert.strictEqual(parseUserInput(' World '), 'world');
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
