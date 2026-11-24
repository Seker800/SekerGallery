import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDedicatedMediaNodeConfig,
  dedicatedMediaKindsOnline,
  deferredJobKinds,
  DEDICATED_MEDIA_FRESH_MS,
} from './dedicated-media-deferral';

const now = new Date('2026-11-25T00:00:00.000Z');

function heartbeat(
  workerId: string,
  ageMs: number,
  capabilities: unknown,
): { workerId: string; heartbeatAt: Date; capabilities: unknown } {
  return { workerId, heartbeatAt: new Date(now.getTime() - ageMs), capabilities };
}

test('a fresh dedicated node defers exactly the kinds it advertises', () => {
  const rows = [
    heartbeat('nas-media', DEDICATED_MEDIA_FRESH_MS - 1, {
      dedicatedMediaKinds: ['GENERATE_RENDITIONS', 'RENDER_EDITED_COPY'],
    }),
    heartbeat('mac-worker', 0, { dedicatedMediaKinds: null }),
  ];
  const online = dedicatedMediaKindsOnline(rows, 'mac-worker', now.getTime());
  assert.deepEqual([...online].sort(), ['GENERATE_RENDITIONS', 'RENDER_EDITED_COPY']);
  assert.deepEqual(
    [...deferredJobKinds(online, ['GENERATE_RENDITIONS', 'GENERATE_EMBEDDING'])].sort(),
    ['GENERATE_RENDITIONS'],
  );
  assert.deepEqual([...deferredJobKinds(online)].sort(), [
    'GENERATE_RENDITIONS',
    'RENDER_EDITED_COPY',
  ]);
});

test('stale or self heartbeats never defer media jobs', () => {
  const stale = [
    heartbeat('nas-media', DEDICATED_MEDIA_FRESH_MS + 1, {
      dedicatedMediaKinds: ['GENERATE_RENDITIONS'],
    }),
  ];
  assert.equal(dedicatedMediaKindsOnline(stale, 'mac-worker', now.getTime()).size, 0);
  const self = [heartbeat('nas-media', 0, { dedicatedMediaKinds: ['GENERATE_RENDITIONS'] })];
  assert.equal(dedicatedMediaKindsOnline(self, 'nas-media', now.getTime()).size, 0);
  assert.deepEqual(deferredJobKinds(new Set()), []);
});

test('plain workers without the dedicated list keep all kinds claimable', () => {
  const rows = [heartbeat('other', 0, { jobKinds: ['GENERATE_RENDITIONS'] })];
  assert.equal(dedicatedMediaKindsOnline(rows, 'mac-worker', now.getTime()).size, 0);
});

test('the dedicated flag requires an explicit non-model kind list', () => {
  assert.doesNotThrow(() =>
    assertDedicatedMediaNodeConfig(true, ['GENERATE_RENDITIONS', 'EXTRACT_COLOR_PALETTE']),
  );
  assert.throws(
    () => assertDedicatedMediaNodeConfig(true, undefined),
    /EAGLE_PROCESSING_JOB_KINDS/,
  );
  assert.throws(() => assertDedicatedMediaNodeConfig(true, []), /EAGLE_PROCESSING_JOB_KINDS/);
  assert.throws(() => assertDedicatedMediaNodeConfig(true, ['GENERATE_EMBEDDING']), /model work/);
  assert.throws(() => assertDedicatedMediaNodeConfig(true, ['GENERATE_AI_TAGS']), /model work/);
  assert.doesNotThrow(() => assertDedicatedMediaNodeConfig(false, undefined));
});
