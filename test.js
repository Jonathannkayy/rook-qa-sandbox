const assert = require('assert');
const http = require('http');

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

function testHealthEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.status, 'ok');
            console.log('PASS: health endpoint');
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

function test404Handler() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/nonexistent`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 404);
            assert.strictEqual(body.error, 'Not Found');
            assert.ok(body.message.includes('Cannot GET'));
            console.log('PASS: 404 handler');
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

function testGlobalErrorHandler() {
  const express = require('express');
  const testApp = express();
  const { asyncHandler } = require('./index');

  // Add a route that throws
  testApp.get('/throw', asyncHandler((req, res) => {
    throw new Error('Test error');
  }));

  // Add the same error handler from index.js
  // eslint-disable-next-line no-unused-vars
  testApp.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(statusCode).json({ error: message });
  });

  return new Promise((resolve, reject) => {
    const server = testApp.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/throw`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 500);
            assert.strictEqual(body.error, 'Test error');
            console.log('PASS: global error handler');
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

function testCustomStatusCodeError() {
  const express = require('express');
  const testApp = express();
  const { asyncHandler } = require('./index');

  testApp.get('/bad-request', asyncHandler((req, res) => {
    const err = new Error('Invalid input');
    err.statusCode = 400;
    throw err;
  }));

  // eslint-disable-next-line no-unused-vars
  testApp.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(statusCode).json({ error: message });
  });

  return new Promise((resolve, reject) => {
    const server = testApp.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/bad-request`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(body.error, 'Invalid input');
            console.log('PASS: custom status code error');
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

(async () => {
  try {
    testParseUserInput();
    testValidateEmail();
    await testHealthEndpoint();
    await test404Handler();
    await testGlobalErrorHandler();
    await testCustomStatusCodeError();
    console.log('All tests passed');
  } catch(e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
