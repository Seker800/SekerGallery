import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaService } from '../../apps/api/dist/prisma/prisma.service.js';
import { LibraryShareRenderService } from '../../apps/api/dist/eagle/library-share-render.service.js';
import { LibraryShareRenderWorker } from '../../apps/api/dist/eagle/library-share-render-worker.js';
import { shareImageSpec } from '../../apps/api/dist/eagle/library-share-image.js';

const prisma = new PrismaService();
before(() => prisma.onModuleInit());
after(() => prisma.onModuleDestroy());
const objects = new Map();
const slowKeys = new Set();

const storage = {
  async getObject(key) {
    const body = objects.get(key);
    if (!body) return { Body: null };
    if (!slowKeys.has(key)) return { Body: Readable.from([body]), ContentLength: body.length };
    async function* slow() {
      await delay(2_000);
      yield body;
    }
    return { Body: Readable.from(slow()), ContentLength: body.length };
  },
  async putObject(key, body) {
    objects.set(key, Buffer.from(body));
  },
};

async function waitFor(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await delay(100);
  }
}

function ownerId() {
  return `share-render-${randomUUID()}`;
}

async function seedAsset(owner, { slow = false } = {}) {
  const jpeg = await sharp({
    create: { width: 1_200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const assetId = randomUUID();
  const key = `users/${owner}/assets/${assetId}/original.jpg`;
  await prisma.user.create({
    data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'test-only' },
  });
  await prisma.eagleAsset.create({
    data: {
      id: assetId,
      ownerId: owner,
      originalName: 'share.jpg',
      displayName: 'share',
      normalizedDisplayName: 'share',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: BigInt(jpeg.length),
      originalObjectKey: key,
      mediaRevision: 0,
    },
  });
  objects.set(key, jpeg);
  if (slow) slowKeys.add(key);
  return { assetId, key, jpeg };
}

async function cleanup(owner) {
  const assets = await prisma.eagleAsset.findMany({
    where: { ownerId: owner },
    select: { id: true },
  });
  const assetIds = assets.map((asset) => asset.id);
  await prisma.eagleObjectDeletion.deleteMany({ where: { ownerId: owner } });
  if (assetIds.length) {
    await prisma.libraryShareRender.deleteMany({ where: { ownerId: owner } });
    await prisma.eagleAssetRendition.deleteMany({ where: { ownerId: owner } });
    await prisma.eagleAsset.deleteMany({ where: { ownerId: owner, id: { in: assetIds } } });
  }
  await prisma.user.deleteMany({ where: { id: owner } });
}

test('renders once into a permanent SHARE_JPEG rendition and serves the queued job', async () => {
  const owner = ownerId();
  const worker = new LibraryShareRenderWorker(prisma, storage);
  try {
    const { assetId, key } = await seedAsset(owner);
    const service = new LibraryShareRenderService(prisma, 'MATERIAL');
    const requested = await service.request(owner, assetId);
    assert.equal(requested.status, 'PENDING');

    worker.start();
    const ready = await waitFor(async () => {
      const row = await prisma.libraryShareRender.findFirst({ where: { ownerId: owner, assetId } });
      return row?.status === 'READY' ? row : null;
    });
    assert.equal(ready.stage, 'READY');
    assert.ok(ready.resultRenditionId);

    const rendition = await prisma.eagleAssetRendition.findUnique({
      where: { id: ready.resultRenditionId },
    });
    assert.equal(rendition.kind, 'SHARE_JPEG');
    assert.equal(rendition.status, 'READY');
    assert.equal(rendition.revision, 0);
    assert.equal(rendition.variant, shareImageSpec());
    assert.ok(rendition.byteSize > 0n);
    assert.equal(rendition.width, 1_200);
    assert.equal(rendition.height, 800);
    const bytes = objects.get(rendition.storageKey);
    assert.ok(bytes && bytes.length === Number(rendition.byteSize));
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    assert.equal(await prisma.eagleObjectDeletion.count({ where: { ownerId: owner } }), 0);

    const status = await service.status(owner, assetId, ready.id);
    assert.equal(status.status, 'READY');
    assert.equal(status.renditionId, rendition.id);
    assert.equal(
      status.contentUrl,
      `/api/eagle/assets/${assetId}/renditions/${rendition.id}/content`,
    );

    const cached = await service.request(owner, assetId);
    assert.equal(cached.status, 'READY');
    assert.equal(cached.cached, true);
    assert.equal(cached.renditionId, rendition.id);
    assert.ok(objects.has(key));
  } finally {
    await worker.stop();
    await cleanup(owner);
  }
});

test('cancels a queued/rendering share job and keeps the original untouched', async () => {
  const owner = ownerId();
  const worker = new LibraryShareRenderWorker(prisma, storage);
  try {
    const { assetId, key } = await seedAsset(owner, { slow: true });
    const service = new LibraryShareRenderService(prisma, 'MATERIAL');
    await service.request(owner, assetId);
    worker.start();
    const processing = await waitFor(async () => {
      const row = await prisma.libraryShareRender.findFirst({ where: { ownerId: owner, assetId } });
      return row?.status === 'PROCESSING' ? row : null;
    });
    const cancelled = await service.cancel(owner, assetId, processing.id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.stage, 'CANCELLED');
    const row = await prisma.libraryShareRender.findFirst({ where: { ownerId: owner, assetId } });
    assert.equal(row.status, 'CANCELLED');
    assert.ok(row.cancelledAt);
    const renditions = await prisma.eagleAssetRendition.count({ where: { ownerId: owner } });
    assert.equal(renditions, 0);
    assert.ok(objects.has(key));
  } finally {
    await worker.stop();
    await cleanup(owner);
  }
});

test('rejects a job whose asset revision changed', async () => {
  const owner = ownerId();
  const worker = new LibraryShareRenderWorker(prisma, storage);
  try {
    const { assetId } = await seedAsset(owner);
    const service = new LibraryShareRenderService(prisma, 'MATERIAL');
    const requested = await service.request(owner, assetId);
    await prisma.eagleAsset.update({
      where: { id: assetId },
      data: { mediaRevision: 1 },
    });
    worker.start();
    const failed = await waitFor(async () => {
      const row = await prisma.libraryShareRender.findUnique({ where: { id: requested.id } });
      return row?.status === 'FAILED' || row?.status === 'CANCELLED' ? row : null;
    });
    assert.equal(failed.errorCode, 'ASSET_CHANGED');
    assert.equal(await prisma.eagleAssetRendition.count({ where: { ownerId: owner } }), 0);
  } finally {
    await worker.stop();
    await cleanup(owner);
  }
});
