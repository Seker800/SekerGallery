import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { LibraryShareRenderService } from './library-share-render.service';
import { renderShareJpeg, shareImageSpec } from './library-share-image';

function httpStatus(error: unknown): number | undefined {
  const candidate = error as { status?: number; getStatus?: () => number };
  return candidate.getStatus?.() ?? candidate.status;
}

function pendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    ownerId: 'owner-a',
    libraryMode: 'MATERIAL',
    assetId: 'asset-1',
    assetRevision: 1,
    spec: shareImageSpec(),
    status: 'PENDING',
    stage: 'QUEUED',
    attempts: 0,
    leaseVersion: 0,
    leaseUntil: null,
    availableAt: new Date(),
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    resultRenditionId: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function shareService(asset: unknown, created?: { value?: Record<string, unknown> }) {
  return new LibraryShareRenderService(
    {
      eagleAsset: { findFirst: async () => asset },
      eagleAssetRendition: { findFirst: async () => null },
      libraryShareRender: {
        findUnique: async () => null,
        create: async (input: { data: Record<string, unknown> }) => {
          if (created) created.value = input.data;
          return pendingJob(input.data);
        },
      },
      $executeRaw: async () => 1,
    } as never,
    'MATERIAL',
  );
}

test('share render requests stay owner-scoped and queue one bounded job', async () => {
  let query: unknown;
  const created: { value?: Record<string, unknown> } = {};
  const service = new LibraryShareRenderService(
    {
      eagleAsset: {
        findFirst: async (input: unknown) => {
          query = input;
          return { id: 'asset-1', mimeType: 'image/jpeg', mediaRevision: 1 };
        },
      },
      eagleAssetRendition: { findFirst: async () => null },
      libraryShareRender: {
        findUnique: async () => null,
        create: async (input: { data: Record<string, unknown> }) => {
          created.value = input.data;
          return pendingJob(input.data);
        },
      },
      $executeRaw: async () => 1,
    } as never,
    'MATERIAL',
  );

  const result = await service.request('owner-a', 'asset-1');

  assert.equal(result.status, 'PENDING');
  assert.equal(result.stage, 'QUEUED');
  assert.deepEqual((query as { where: unknown }).where, {
    ownerId: 'owner-a',
    id: 'asset-1',
    purgeAfter: null,
    isPrivate: false,
    libraryMode: 'MATERIAL',
  });
  assert.deepEqual((query as { select: unknown }).select, {
    id: true,
    mimeType: true,
    mediaRevision: true,
  });
  assert.equal(created.value?.ownerId, 'owner-a');
  assert.equal(created.value?.libraryMode, 'MATERIAL');
  assert.equal(created.value?.assetId, 'asset-1');
  assert.equal(created.value?.assetRevision, 1);
  assert.equal(created.value?.spec, shareImageSpec());
});

test('share render requests refuse non-image assets', async () => {
  const service = shareService({ id: 'asset-1', mimeType: 'video/mp4', mediaRevision: 1 });

  await assert.rejects(service.request('owner-a', 'asset-1'), (error) => {
    assert.equal(httpStatus(error), 400);
    return true;
  });
});

test('share render requests hide cross-owner and private assets as not found', async () => {
  const service = shareService(null);

  await assert.rejects(service.request('owner-b', 'asset-1', false), (error) => {
    assert.equal(httpStatus(error), 404);
    return true;
  });
});

test('share encoding lowers quality and then dimensions to stay under the byte ceiling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-share-test-'));
  try {
    const noise = randomBytes(1_600 * 1_067 * 3);
    const source = await sharp(noise, { raw: { width: 1_600, height: 1_067, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const path = join(directory, 'noise.jpg');
    await writeFile(path, source);
    const rendered = await renderShareJpeg(path, {
      maxEdge: 1_600,
      maxBytes: 300 * 1024,
      minQuality: 60,
    });
    assert.ok(rendered.byteSize <= 300 * 1024);
    assert.ok(rendered.width < 1_600);
    assert.equal(rendered.buffer.subarray(0, 2).toString('hex'), 'ffd8');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
