import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDedicatedEditRendererConfig,
  dedicatedEditRendererOnline,
  deferredJobKinds,
  EDIT_RENDER_FRESH_MS,
} from './edit-render-deferral';

const now = new Date('2026-11-24T15:00:00.000Z');

function heartbeat(
  workerId: string,
  ageMs: number,
  capabilities: unknown,
): { workerId: string; heartbeatAt: Date; capabilities: unknown } {
  return { workerId, heartbeatAt: new Date(now.getTime() - ageMs), capabilities };
}

test('a fresh dedicated edit renderer defers edit renders from other workers', () => {
  const rows = [
    heartbeat('nas-edit', EDIT_RENDER_FRESH_MS - 1, { editRendererDedicated: true }),
    heartbeat('mac-worker', 0, { editRendererDedicated: false }),
  ];
  assert.equal(dedicatedEditRendererOnline(rows, 'mac-worker', now.getTime()), true);
  assert.deepEqual(deferredJobKinds(true), ['RENDER_EDITED_COPY']);
});

test('a stale or self heartbeat never defers edit renders', () => {
  const stale = [heartbeat('nas-edit', EDIT_RENDER_FRESH_MS + 1, { editRendererDedicated: true })];
  assert.equal(dedicatedEditRendererOnline(stale, 'mac-worker', now.getTime()), false);
  const self = [heartbeat('nas-edit', 0, { editRendererDedicated: true })];
  assert.equal(dedicatedEditRendererOnline(self, 'nas-edit', now.getTime()), false);
  assert.deepEqual(deferredJobKinds(false), []);
});

test('only the explicit dedicated flag defers; plain workers keep the kind claimable', () => {
  const rows = [heartbeat('other', 0, { jobKinds: ['RENDER_EDITED_COPY'] })];
  assert.equal(dedicatedEditRendererOnline(rows, 'mac-worker', now.getTime()), false);
});

test('the dedicated flag requires exactly the edit render kind', () => {
  assert.doesNotThrow(() => assertDedicatedEditRendererConfig(true, ['RENDER_EDITED_COPY']));
  assert.throws(() => assertDedicatedEditRendererConfig(true, undefined), /RENDER_EDITED_COPY/);
  assert.throws(
    () => assertDedicatedEditRendererConfig(true, ['RENDER_EDITED_COPY', 'GENERATE_EMBEDDING']),
    /RENDER_EDITED_COPY/,
  );
  assert.doesNotThrow(() => assertDedicatedEditRendererConfig(false, undefined));
});
