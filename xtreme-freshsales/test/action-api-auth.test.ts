import assert from 'node:assert/strict';
import test from 'node:test';
import { actionApiAuth } from '../src/action-api-auth.js';

function run(headers: Record<string, string | undefined>) {
  const middleware = actionApiAuth('test-secret-1234567890');
  let statusCode = 200;
  let body: any;
  let nextCalled = false;

  const req = {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    }
  } as any;

  middleware(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

test('accepts Bearer connector secret', () => {
  const result = run({ authorization: 'Bearer test-secret-1234567890' });
  assert.equal(result.nextCalled, true);
});

test('accepts raw Authorization connector secret', () => {
  const result = run({ authorization: 'test-secret-1234567890' });
  assert.equal(result.nextCalled, true);
});

test('accepts X-Connector-Key connector secret', () => {
  const result = run({ 'x-connector-key': 'test-secret-1234567890' });
  assert.equal(result.nextCalled, true);
});

test('reports missing connector credential without exposing secret', () => {
  const result = run({});
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.reason, 'missing_connector_credential');
  assert.equal(JSON.stringify(result.body).includes('test-secret-1234567890'), false);
});

test('reports credential mismatch and source without exposing secret', () => {
  const result = run({ authorization: 'Bearer wrong-secret' });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.reason, 'connector_credential_mismatch');
  assert.deepEqual(result.body.credential_sources, ['bearer']);
  assert.equal(JSON.stringify(result.body).includes('test-secret-1234567890'), false);
});
