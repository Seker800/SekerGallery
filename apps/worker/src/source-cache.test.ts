import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  DEFAULT_SOURCE_CACHE_BYTES,
  WorkerSourceCache,
  sourceCacheBytesFromEnvironment,
  workerSourceCacheKey,
} from './source-cache';

const bytes = Buffer.from('cached-original-bytes');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const key = (overrides: Partial<Parameters<WorkerSourceCache['lookup']>[0]> = {}) => ({
  ownerId: 'owner-a',
  libraryMode: 'PHOTO',
  objectKey: 'users/owner-a/assets/asset-1/original.jpg',
  mediaRevision: 3,
  size: bytes.length,
  ...overrides,
});

async function captureThrough(
  cache: WorkerSourceCache,
  sourceKey: ReturnType<typeof key>,
  source: Buffer = bytes,
  sha256 = digest(source),
) {
  const capture = await cache.tee(sourceKey, Readable.from([source]));
  const seen: Buffer[] = [];
  for await (const chunk of capture.source) seen.push(Buffer.from(chunk));
  await capture.commit(sha256);
  return Buffer.concat(seen);
}

test('a captured preview source is served to the pyramid by key, revision and size', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-cache-test-'));
  try {
    const cache = new WorkerSourceCache({ directory, maxBytes: 1024 });
    assert.deepEqual(await captureThrough(cache, key()), bytes);
    const hit = await cache.lookup(key());
    assert.ok(hit);
    assert.equal(hit!.sha256, digest(bytes));
    assert.equal(hit!.size, bytes.length);
    assert.deepEqual(await readFile(hit!.path), bytes);
    assert.equal(cache.usedBytes, bytes.length);
    // A different revision or size is a miss and never reuses the old hash.
    assert.equal(await cache.lookup(key({ mediaRevision: 4 })), null);
    assert.equal(await cache.lookup(key({ size: bytes.length + 1 })), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a miss, truncated transfer or aborted capture leaves no reusable file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-cache-test-'));
  try {
    const cache = new WorkerSourceCache({ directory, maxBytes: 1024 });
    assert.equal(await cache.lookup(key()), null);
    // The caller commits the hash of what it read, but fewer bytes than declared.
    await captureThrough(cache, key(), bytes.subarray(0, 4));
    assert.equal(await cache.lookup(key()), null);
    const capture = await cache.tee(key(), Readable.from([bytes]));
    await capture.abort();
    assert.equal(await cache.lookup(key()), null);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('corrupted or resized cache files fall back to a miss instead of the recorded hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-cache-test-'));
  try {
    const cache = new WorkerSourceCache({ directory, maxBytes: 1024 });
    await captureThrough(cache, key());
    const hit = await cache.lookup(key());
    assert.ok(hit);
    // Same length, different bytes: the reader detects it and invalidates the entry.
    await writeFile(hit!.path, Buffer.alloc(bytes.length, 7));
    const corrupted = await cache.lookup(key());
    assert.ok(corrupted);
    assert.notEqual(digest(await readFile(corrupted!.path)), corrupted!.sha256);
    await cache.invalidate(corrupted!);
    assert.equal(await cache.lookup(key()), null);
    // A length change is rejected by lookup itself.
    await captureThrough(cache, key());
    const resized = await cache.lookup(key());
    assert.ok(resized);
    await writeFile(resized!.path, Buffer.from('short'));
    assert.equal(await cache.lookup(key()), null);
    assert.equal(await stat(resized!.path).catch(() => null), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the cache evicts least-recently-used entries at its disk bound', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-cache-test-'));
  try {
    const first = key({ objectKey: 'users/owner-a/assets/one/original.jpg' });
    const second = key({ objectKey: 'users/owner-a/assets/two/original.jpg' });
    const cache = new WorkerSourceCache({ directory, maxBytes: bytes.length + 4 });
    await captureThrough(cache, first);
    const firstHit = await cache.lookup(first);
    assert.ok(firstHit);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await captureThrough(cache, second);
    assert.ok(cache.usedBytes <= bytes.length + 4);
    assert.equal(await cache.lookup(first), null, 'the older entry is evicted');
    assert.ok(await cache.lookup(second));
    assert.equal(await stat(firstHit!.path).catch(() => null), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a disabled cache degrades to passthrough and invalid limits use the 2 GiB default', async () => {
  const cache = new WorkerSourceCache({ maxBytes: 0 });
  assert.equal(cache.enabled, false);
  const capture = await cache.tee(key(), Readable.from([bytes]));
  const seen: Buffer[] = [];
  for await (const chunk of capture.source) seen.push(Buffer.from(chunk));
  await capture.commit(digest(bytes));
  assert.deepEqual(Buffer.concat(seen), bytes);
  assert.equal(await cache.lookup(key()), null);
  assert.equal(sourceCacheBytesFromEnvironment(undefined), DEFAULT_SOURCE_CACHE_BYTES);
  assert.equal(sourceCacheBytesFromEnvironment('garbage'), DEFAULT_SOURCE_CACHE_BYTES);
  assert.equal(sourceCacheBytesFromEnvironment('0'), 0);
  assert.equal(sourceCacheBytesFromEnvironment('1048576'), 1048576);
});

test('cache keys carry the original identity and reject unusable sizes', () => {
  assert.deepEqual(
    workerSourceCacheKey({
      ownerId: 'owner-a',
      libraryMode: 'MATERIAL',
      objectKey: 'users/owner-a/assets/a/original.jpg',
      mediaRevision: 2,
      size: 42n,
    }),
    {
      ownerId: 'owner-a',
      libraryMode: 'MATERIAL',
      objectKey: 'users/owner-a/assets/a/original.jpg',
      mediaRevision: 2,
      size: 42,
    },
  );
  assert.equal(
    workerSourceCacheKey({
      ownerId: 'owner-a',
      libraryMode: 'PHOTO',
      objectKey: 'k',
      mediaRevision: 1,
      size: 0,
    }),
    null,
  );
});
