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

function testValidateName() {
  const { validateName } = require('./index');
  assert.strictEqual(validateName('Jane Doe'), true);
  assert.strictEqual(validateName(' J '), false);
  assert.strictEqual(validateName(''), false);
  assert.strictEqual(validateName(null), false);
  console.log('PASS: validateName');
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
            // Uptime fields
            assert.strictEqual(typeof body.startedAt, 'string');
            assert.ok(!isNaN(Date.parse(body.startedAt)), 'startedAt must be valid ISO date');
            assert.strictEqual(typeof body.uptime_seconds, 'number');
            assert.ok(body.uptime_seconds >= 0, 'uptime_seconds must be non-negative');
            assert.strictEqual(typeof body.uptime, 'string');
            assert.ok(body.uptime.endsWith('s'), 'uptime must end with seconds');
            assert.strictEqual(typeof body.process_uptime, 'number');
            assert.ok(body.process_uptime >= 0, 'process_uptime must be non-negative');
            // Memory usage fields
            assert.strictEqual(typeof body.memory, 'object', 'memory must be an object');
            assert.strictEqual(typeof body.memory.rss, 'number', 'rss must be a number');
            assert.strictEqual(typeof body.memory.heapUsed, 'number', 'heapUsed must be a number');
            assert.strictEqual(typeof body.memory.heapTotal, 'number', 'heapTotal must be a number');
            assert.strictEqual(typeof body.memory.external, 'number', 'external must be a number');
            assert.ok(body.memory.rss > 0, 'rss must be positive');
            assert.ok(body.memory.heapUsed > 0, 'heapUsed must be positive');
            assert.ok(body.memory.heapTotal > 0, 'heapTotal must be positive');
            assert.ok(body.memory.heapUsed <= body.memory.heapTotal, 'heapUsed must not exceed heapTotal');
            assert.ok(body.memory.rss >= body.memory.heapUsed, 'rss must be >= heapUsed');
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

function testHealthMemoryUsage() {
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
            // memory object has exactly the expected keys
            const memKeys = Object.keys(body.memory).sort();
            assert.deepStrictEqual(memKeys, ['external', 'heapTotal', 'heapUsed', 'rss']);
            // all values are positive integers (bytes)
            for (const key of memKeys) {
              assert.ok(Number.isInteger(body.memory[key]), `${key} must be an integer`);
              assert.ok(body.memory[key] >= 0, `${key} must be non-negative`);
            }
            // sanity: heapUsed <= heapTotal <= rss (typical invariant)
            assert.ok(body.memory.heapUsed <= body.memory.heapTotal, 'heapUsed <= heapTotal');
            console.log('PASS: health memory usage');
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

function testFormatUptime() {
  const { formatUptime } = require('./index');
  assert.strictEqual(formatUptime(0), '0s');
  assert.strictEqual(formatUptime(999), '0s');
  assert.strictEqual(formatUptime(1000), '1s');
  assert.strictEqual(formatUptime(61000), '1m 1s');
  assert.strictEqual(formatUptime(3661000), '1h 1m 1s');
  assert.strictEqual(formatUptime(90061000), '1d 1h 1m 1s');
  assert.strictEqual(formatUptime(86400000), '1d 0s');
  console.log('PASS: formatUptime');
}

function testVersionEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/version`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.version, '1.0.0');
            console.log('PASS: version endpoint');
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

function postJson(port, path, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ res, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function testValidateEndpointSuccess() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/validate', {
          email: 'Test@Example.com',
          name: 'Jane Doe'
        });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(body.valid, true);
        assert.strictEqual(body.email, 'test@example.com');
        assert.strictEqual(body.name, 'Jane Doe');
        console.log('PASS: validate endpoint success');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testValidateEndpointInvalidEmail() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/validate', {
          email: 'bad-email',
          name: 'Jane Doe'
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.email, 'Invalid email');
        assert.strictEqual(body.errors.name, null);
        console.log('PASS: validate endpoint invalid email');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testValidateEndpointInvalidName() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/validate', {
          email: 'test@example.com',
          name: ' '
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.email, null);
        assert.strictEqual(body.errors.name, 'Invalid name');
        console.log('PASS: validate endpoint invalid name');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testValidateEndpointInvalidBoth() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/validate', {
          email: null,
          name: ''
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.email, 'Invalid email');
        assert.strictEqual(body.errors.name, 'Invalid name');
        console.log('PASS: validate endpoint invalid both');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
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
            assert.strictEqual(res.headers['content-type'].includes('application/json'), true, 'Content-Type must be application/json');
            assert.strictEqual(body.error, 'Not Found');
            assert.strictEqual(body.path, '/nonexistent');
            assert.strictEqual(body.status, 404);
            assert.strictEqual(body.code, 'NOT_FOUND');
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

function test404HandlerWithDifferentPath() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/some/deep/path`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 404);
            assert.strictEqual(body.error, 'Not Found');
            assert.strictEqual(body.path, '/some/deep/path');
            assert.strictEqual(body.status, 404);
            assert.strictEqual(body.code, 'NOT_FOUND');
            console.log('PASS: 404 handler with different path');
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

function test404HandlerPost() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/does-not-exist',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 404);
            assert.strictEqual(body.error, 'Not Found');
            assert.strictEqual(body.path, '/does-not-exist');
            assert.strictEqual(body.status, 404);
            assert.strictEqual(body.code, 'NOT_FOUND');
            console.log('PASS: 404 handler POST method');
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

function testGlobalErrorHandler() {
  const express = require('express');
  const testApp = express();
  const { asyncHandler, createErrorResponse } = require('./index');

  // Add a route that throws
  testApp.get('/throw', asyncHandler((req, res) => {
    throw new Error('Test error');
  }));

  // Add the same error handler from index.js
  // eslint-disable-next-line no-unused-vars
  testApp.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    const code = err.code || 'INTERNAL_ERROR';
    res.status(statusCode).json(createErrorResponse(statusCode, message, code));
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
            assert.strictEqual(body.status, 500);
            assert.strictEqual(body.code, 'INTERNAL_ERROR');
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
  const { asyncHandler, createErrorResponse } = require('./index');

  testApp.get('/bad-request', asyncHandler((req, res) => {
    const err = new Error('Invalid input');
    err.statusCode = 400;
    throw err;
  }));

  // eslint-disable-next-line no-unused-vars
  testApp.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    const code = err.code || 'INTERNAL_ERROR';
    res.status(statusCode).json(createErrorResponse(statusCode, message, code));
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
            assert.strictEqual(body.status, 400);
            assert.strictEqual(body.code, 'INTERNAL_ERROR');
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

function testRequestLoggerExport() {
  const { requestLogger } = require('./index');
  assert.strictEqual(typeof requestLogger, 'function');
  assert.strictEqual(requestLogger.length, 3); // (req, res, next)
  console.log('PASS: requestLogger export');
}

function testRequestLoggerMiddleware() {
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
            // If logger broke the chain, we wouldn't get 200
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.status, 'ok');
            console.log('PASS: requestLogger middleware');
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

function testRequestLoggerCallsNext() {
  const { requestLogger } = require('./index');
  return new Promise((resolve, reject) => {
    const fakeReq = { method: 'GET', originalUrl: '/test' };
    const listeners = {};
    const fakeRes = {
      on(event, cb) { listeners[event] = cb; },
      statusCode: 200
    };
    let nextCalled = false;
    requestLogger(fakeReq, fakeRes, () => { nextCalled = true; });
    try {
      assert.strictEqual(nextCalled, true, 'next() must be called');
      assert.strictEqual(typeof listeners.finish, 'function', 'finish listener must be registered');
      console.log('PASS: requestLogger calls next');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function testRequestLoggerLogsOnFinish() {
  const { requestLogger } = require('./index');
  return new Promise((resolve, reject) => {
    const fakeReq = { method: 'POST', originalUrl: '/data' };
    const listeners = {};
    const fakeRes = {
      on(event, cb) { listeners[event] = cb; },
      statusCode: 201
    };
    const origLog = console.log;
    const origEnv = process.env.NODE_ENV;
    let loggedMessage = null;
    try {
      process.env.NODE_ENV = 'development';
      console.log = (msg) => { loggedMessage = msg; };
      requestLogger(fakeReq, fakeRes, () => {});
      assert.ok(listeners.finish, 'finish listener must exist');
      listeners.finish();
      assert.ok(loggedMessage !== null, 'must log a message');
      assert.ok(loggedMessage.includes('POST'), 'log must contain method');
      assert.ok(loggedMessage.includes('/data'), 'log must contain url');
      assert.ok(loggedMessage.includes('201'), 'log must contain status code');
      assert.ok(/\d+ms/.test(loggedMessage), 'log must contain duration in ms');
      console.log = origLog;
      console.log('PASS: requestLogger logs on finish');
      resolve();
    } catch (err) {
      console.log = origLog;
      reject(err);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
}

function testRequestLoggerSilentInTest() {
  const { requestLogger } = require('./index');
  return new Promise((resolve, reject) => {
    const fakeReq = { method: 'GET', originalUrl: '/quiet' };
    const listeners = {};
    const fakeRes = {
      on(event, cb) { listeners[event] = cb; },
      statusCode: 200
    };
    const origLog = console.log;
    const origEnv = process.env.NODE_ENV;
    let logCalled = false;
    try {
      process.env.NODE_ENV = 'test';
      console.log = () => { logCalled = true; };
      requestLogger(fakeReq, fakeRes, () => {});
      listeners.finish();
      console.log = origLog;
      assert.strictEqual(logCalled, false, 'must NOT log when NODE_ENV=test');
      console.log('PASS: requestLogger silent in test env');
      resolve();
    } catch (err) {
      console.log = origLog;
      reject(err);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
}

function testMetricsEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/metrics`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(typeof body.uptime, 'number');
            assert.ok(body.uptime >= 0, 'uptime must be non-negative');
            assert.strictEqual(typeof body.requestCount, 'number');
            assert.ok(body.requestCount >= 1, 'requestCount must be at least 1');
            assert.strictEqual(typeof body.memoryUsage, 'object');
            assert.ok(body.memoryUsage.rss > 0, 'rss must be positive');
            assert.ok(body.memoryUsage.heapTotal > 0, 'heapTotal must be positive');
            assert.ok(body.memoryUsage.heapUsed > 0, 'heapUsed must be positive');
            console.log('PASS: metrics endpoint');
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

function testReadyEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/ready`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.ready, true);
            assert.ok(Array.isArray(body.checks), 'checks must be an array');
            assert.ok(body.checks.length >= 1, 'must have at least one check');
            assert.ok(body.checks.every(c => c.ready === true), 'all checks must be ready');
            console.log('PASS: ready endpoint (200)');
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

function testReadyEndpointUnhealthy() {
  const app = require('./index');
  const { addDependencyCheck } = require('./index');
  // Add a failing dependency check
  addDependencyCheck('failing-dep', async () => false);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/ready`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 503);
            assert.strictEqual(body.ready, false);
            assert.ok(Array.isArray(body.checks), 'checks must be an array');
            const failingCheck = body.checks.find(c => c.name === 'failing-dep');
            assert.ok(failingCheck, 'must include failing-dep check');
            assert.strictEqual(failingCheck.ready, false);
            console.log('PASS: ready endpoint (503)');
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

function testWorktreeVerifyEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/worktree-verify`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.isolated, true);
            console.log('PASS: worktree-verify endpoint');
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

function testPtyFixTestEndpoint() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/pty-fix-test`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body.pty, 'fixed');
            assert.strictEqual(typeof body.timestamp, 'number');
            assert.ok(body.timestamp > 0, 'timestamp must be positive');
            assert.ok(body.timestamp <= Date.now(), 'timestamp must not be in the future');
            console.log('PASS: pty-fix-test endpoint');
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

function testCommentsEndpointSuccess() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          text: 'Great post!',
          author: 'Alice'
        });
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(body.text, 'Great post!');
        assert.strictEqual(body.author, 'Alice');
        console.log('PASS: comments endpoint success');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointEmptyBody() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const req = http.request({
          hostname: 'localhost',
          port,
          path: '/comments',
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const body = JSON.parse(data);
              assert.strictEqual(res.statusCode, 400);
              assert.strictEqual(body.error, 'Request body is required');
              assert.strictEqual(body.status, 400);
              assert.strictEqual(body.code, 'BAD_REQUEST');
              console.log('PASS: comments endpoint empty body');
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              server.close();
            }
          });
        });
        req.on('error', (err) => { server.close(); reject(err); });
        req.end();
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
}

function testCommentsEndpointMissingText() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          author: 'Alice'
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.text, 'Text must be a non-empty string');
        assert.strictEqual(body.errors.author, undefined);
        console.log('PASS: comments endpoint missing text');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointEmptyText() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          text: '',
          author: 'Alice'
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.text, 'Text must be a non-empty string');
        console.log('PASS: comments endpoint empty text');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointWhitespaceText() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          text: '   ',
          author: 'Alice'
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.text, 'Text must be a non-empty string');
        console.log('PASS: comments endpoint whitespace text');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointMissingAuthor() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          text: 'Nice article'
        });
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.author, 'Author is required');
        assert.strictEqual(body.errors.text, undefined);
        console.log('PASS: comments endpoint missing author');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointMissingBoth() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {});
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(body.error, 'Validation failed');
        assert.strictEqual(body.status, 400);
        assert.strictEqual(body.code, 'VALIDATION_ERROR');
        assert.strictEqual(body.errors.text, 'Text must be a non-empty string');
        assert.strictEqual(body.errors.author, 'Author is required');
        console.log('PASS: comments endpoint missing both');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCommentsEndpointTrimsFields() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;
        const { res, body } = await postJson(port, '/comments', {
          text: '  Hello world  ',
          author: '  Bob  '
        });
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(body.text, 'Hello world');
        assert.strictEqual(body.author, 'Bob');
        console.log('PASS: comments endpoint trims fields');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testRateLimiterExport() {
  const { rateLimiter } = require('./index');
  assert.strictEqual(typeof rateLimiter, 'function');
  console.log('PASS: rateLimiter export');
}

function testRateLimitHeaders() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            assert.strictEqual(res.statusCode, 200);
            // draft-7 combined header format
            assert.ok(res.headers['ratelimit'], 'must have ratelimit header');
            assert.ok(res.headers['ratelimit-policy'], 'must have ratelimit-policy header');
            assert.ok(res.headers['ratelimit'].includes('limit='), 'ratelimit header must contain limit');
            assert.ok(res.headers['ratelimit'].includes('remaining='), 'ratelimit header must contain remaining');
            assert.ok(res.headers['ratelimit'].includes('reset='), 'ratelimit header must contain reset');
            console.log('PASS: rate limit headers');
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

function testRateLimitEnforced() {
  const express = require('express');
  const rateLimit = require('express-rate-limit');
  const testApp = express();

  // Create a limiter with a very low limit for testing
  const testLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
  });
  testApp.use(testLimiter);
  testApp.get('/test', (req, res) => res.json({ ok: true }));

  return new Promise((resolve, reject) => {
    const server = testApp.listen(0, async () => {
      const port = server.address().port;
      try {
        // Make 3 requests (within limit)
        for (let i = 0; i < 3; i++) {
          await new Promise((res, rej) => {
            http.get(`http://localhost:${port}/test`, (response) => {
              let d = '';
              response.on('data', chunk => d += chunk);
              response.on('end', () => {
                assert.strictEqual(response.statusCode, 200, `Request ${i + 1} should succeed`);
                res();
              });
            }).on('error', rej);
          });
        }

        // 4th request should be rate limited
        await new Promise((res, rej) => {
          http.get(`http://localhost:${port}/test`, (response) => {
            let d = '';
            response.on('data', chunk => d += chunk);
            response.on('end', () => {
              try {
                assert.strictEqual(response.statusCode, 429, 'Must return 429 when rate limited');
                const body = JSON.parse(d);
                assert.strictEqual(body.error, 'Too many requests, please try again later');
                console.log('PASS: rate limit enforced (429)');
                res();
              } catch (err) {
                rej(err);
              }
            });
          }).on('error', rej);
        });

        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testCreateErrorResponseBasic() {
  const { createErrorResponse } = require('./index');
  const result = createErrorResponse(404, 'Not Found', 'NOT_FOUND');
  assert.deepStrictEqual(result, { error: 'Not Found', status: 404, code: 'NOT_FOUND' });
  console.log('PASS: createErrorResponse basic');
}

function testCreateErrorResponseWithExtra() {
  const { createErrorResponse } = require('./index');
  const result = createErrorResponse(400, 'Validation failed', 'VALIDATION_ERROR', { errors: { name: 'required' } });
  assert.strictEqual(result.error, 'Validation failed');
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.code, 'VALIDATION_ERROR');
  assert.strictEqual(result.errors.name, 'required');
  console.log('PASS: createErrorResponse with extra');
}

function testCreateErrorResponseNoCode() {
  const { createErrorResponse } = require('./index');
  const result = createErrorResponse(500, 'Server error');
  assert.strictEqual(result.error, 'Server error');
  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.code, undefined);
  console.log('PASS: createErrorResponse no code');
}

// Verify every error path returns the standard shape: { error: string, status: number }
function assertStandardErrorShape(body, expectedStatus) {
  assert.strictEqual(typeof body.error, 'string', 'error must be a string');
  assert.strictEqual(typeof body.status, 'number', 'status must be a number');
  assert.strictEqual(body.status, expectedStatus, `status must be ${expectedStatus}`);
  if (body.code !== undefined) {
    assert.strictEqual(typeof body.code, 'string', 'code must be a string when present');
  }
}

function testErrorShapeConsistency() {
  const app = require('./index');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = server.address().port;

        // 404 - unknown route
        const r404 = await new Promise((res, rej) => {
          http.get(`http://localhost:${port}/unknown-route`, (resp) => {
            let d = '';
            resp.on('data', c => d += c);
            resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d) }));
          }).on('error', rej);
        });
        assertStandardErrorShape(r404.body, 404);
        assert.strictEqual(r404.body.code, 'NOT_FOUND');

        // 400 - health with query params
        const r400health = await new Promise((res, rej) => {
          http.get(`http://localhost:${port}/health?foo=bar`, (resp) => {
            let d = '';
            resp.on('data', c => d += c);
            resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d) }));
          }).on('error', rej);
        });
        assertStandardErrorShape(r400health.body, 400);
        assert.strictEqual(r400health.body.code, 'BAD_REQUEST');

        // 400 - validate with bad data
        const r400validate = await postJson(port, '/validate', { email: 'bad', name: '' });
        assertStandardErrorShape(r400validate.body, 400);
        assert.strictEqual(r400validate.body.code, 'VALIDATION_ERROR');
        assert.ok(r400validate.body.errors, 'validate errors must include errors detail');

        // 400 - comments empty body
        const r400comments = await postJson(port, '/comments', {});
        assertStandardErrorShape(r400comments.body, 400);
        assert.strictEqual(r400comments.body.code, 'VALIDATION_ERROR');

        console.log('PASS: error shape consistency across all paths');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function testErrorShapeOnThrow() {
  const express = require('express');
  const { asyncHandler, createErrorResponse } = require('./index');
  const testApp = express();

  testApp.get('/err-no-code', asyncHandler(() => { throw new Error('boom'); }));
  testApp.get('/err-with-code', asyncHandler(() => {
    const e = new Error('forbidden');
    e.statusCode = 403;
    e.code = 'FORBIDDEN';
    throw e;
  }));

  // eslint-disable-next-line no-unused-vars
  testApp.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    const code = err.code || 'INTERNAL_ERROR';
    res.status(statusCode).json(createErrorResponse(statusCode, message, code));
  });

  return new Promise((resolve, reject) => {
    const server = testApp.listen(0, async () => {
      try {
        const port = server.address().port;

        // Default 500 with no custom code
        const r500 = await new Promise((res, rej) => {
          http.get(`http://localhost:${port}/err-no-code`, (resp) => {
            let d = '';
            resp.on('data', c => d += c);
            resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d) }));
          }).on('error', rej);
        });
        assertStandardErrorShape(r500.body, 500);
        assert.strictEqual(r500.body.code, 'INTERNAL_ERROR');
        assert.strictEqual(r500.body.error, 'boom');

        // Custom status + code
        const r403 = await new Promise((res, rej) => {
          http.get(`http://localhost:${port}/err-with-code`, (resp) => {
            let d = '';
            resp.on('data', c => d += c);
            resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d) }));
          }).on('error', rej);
        });
        assertStandardErrorShape(r403.body, 403);
        assert.strictEqual(r403.body.code, 'FORBIDDEN');
        assert.strictEqual(r403.body.error, 'forbidden');

        console.log('PASS: error shape on thrown errors');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

(async () => {
  try {
    testParseUserInput();
    testValidateEmail();
    testValidateName();
    testRequestLoggerExport();
    await testHealthEndpoint();
    await testHealthMemoryUsage();
    testFormatUptime();
    await testVersionEndpoint();
    await testValidateEndpointSuccess();
    await testValidateEndpointInvalidEmail();
    await testValidateEndpointInvalidName();
    await testValidateEndpointInvalidBoth();
    await test404Handler();
    await test404HandlerWithDifferentPath();
    await test404HandlerPost();
    await testGlobalErrorHandler();
    await testCustomStatusCodeError();
    await testRequestLoggerMiddleware();
    await testRequestLoggerCallsNext();
    await testRequestLoggerLogsOnFinish();
    await testRequestLoggerSilentInTest();
    await testMetricsEndpoint();
    await testReadyEndpoint();
    await testReadyEndpointUnhealthy();
    await testWorktreeVerifyEndpoint();
    await testPtyFixTestEndpoint();
    await testCommentsEndpointSuccess();
    await testCommentsEndpointEmptyBody();
    await testCommentsEndpointMissingText();
    await testCommentsEndpointEmptyText();
    await testCommentsEndpointWhitespaceText();
    await testCommentsEndpointMissingAuthor();
    await testCommentsEndpointMissingBoth();
    await testCommentsEndpointTrimsFields();
    testRateLimiterExport();
    await testRateLimitHeaders();
    await testRateLimitEnforced();
    testCreateErrorResponseBasic();
    testCreateErrorResponseWithExtra();
    testCreateErrorResponseNoCode();
    await testErrorShapeConsistency();
    await testErrorShapeOnThrow();
    console.log('All tests passed');
  } catch(e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
