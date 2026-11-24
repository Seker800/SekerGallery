import assert from 'node:assert/strict';
import test from 'node:test';
import { TAG_BUILD_FAILURE_LIMIT, retryDelayMs } from './task-retry';

test('shared backoff keeps the existing media and tag curve', () => {
  const options = { baseMs: 1000, capMs: 3_600_000, exponentCap: 12 };
  assert.equal(retryDelayMs(0, options), 1000);
  assert.equal(retryDelayMs(1, options), 2000);
  assert.equal(retryDelayMs(10, options), 1_024_000);
  assert.equal(retryDelayMs(20, options), 3_600_000);
});

test('smart-folder and map curves retain their own base and cap', () => {
  assert.equal(
    retryDelayMs(1, { baseMs: 30_000, capMs: 900_000, exponentOffset: -1, exponentCap: 10 }),
    30_000,
  );
  assert.equal(
    retryDelayMs(3, { baseMs: 30_000, capMs: 900_000, exponentOffset: -1, exponentCap: 10 }),
    120_000,
  );
  assert.equal(retryDelayMs(10, { baseMs: 30_000, capMs: 900_000, exponentCap: 5 }), 900_000);
});

test('tag builds have one failure budget for clean failures and expired leases', () => {
  assert.equal(TAG_BUILD_FAILURE_LIMIT, 5);
});
