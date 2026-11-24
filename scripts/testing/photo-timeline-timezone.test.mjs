import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { PhotoManagementService } from '../../apps/api/dist/photos/photo-management.service.js';
import { decodeEagleAssetCursor } from '../../apps/api/dist/eagle/eagle-cursor.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

async function asset(db, owner, chronologicalAt, isPrivate = false) {
  const id = randomUUID();
  await db.eagleAsset.create({
    data: {
      id,
      ownerId: owner,
      libraryMode: 'PHOTO',
      originalName: 'timeline.jpg',
      displayName: 'timeline',
      normalizedDisplayName: 'timeline',
      mimeType: 'image/jpeg',
      format: 'jpeg',
      byteSize: 1n,
      originalObjectKey: `users/${owner}/assets/${id}/original.jpg`,
      lifecycleStatus: 'READY',
      chronologicalAt,
      libraryAddedAt: chronologicalAt,
      isPrivate,
    },
  });
}

test('photo timeline day and month buckets follow the requested local timezone', async () => {
  const owner = randomUUID();
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  const service = new PhotoManagementService(db);
  try {
    await db.user.create({
      data: { id: owner, email: `${owner}@example.invalid`, passwordHash: 'synthetic' },
    });
    await asset(db, owner, new Date('2026-03-08T04:30:00Z'));
    await asset(db, owner, new Date('2026-03-08T17:00:00Z'));
    await asset(db, owner, new Date('2026-03-09T02:00:00Z'), true);

    const newYork = await service.timeline(owner, false, 'CAPTURED_AT', 'America/New_York');
    assert.deepEqual(
      newYork.days.map((day) => day.date),
      ['2026-03-08', '2026-03-07'],
    );
    assert.equal(newYork.total, 2);
    assert.equal(newYork.months[0].month, '2026-03');
    assert.equal(newYork.months[0].count, 2);
    assert.equal(
      decodeEagleAssetCursor(newYork.months[0].cursor, {
        ownerId: owner,
        libraryMode: 'PHOTO',
      }).libraryAddedAt.toISOString(),
      '2026-04-01T04:00:00.000Z',
    );

    const shanghai = await service.timeline(owner, false, 'CAPTURED_AT', 'Asia/Shanghai');
    assert.deepEqual(
      shanghai.days.map((day) => day.date),
      ['2026-03-09', '2026-03-08'],
    );
    assert.equal(shanghai.total, 2);
    assert.equal(
      decodeEagleAssetCursor(shanghai.months[0].cursor, {
        ownerId: owner,
        libraryMode: 'PHOTO',
      }).libraryAddedAt.toISOString(),
      '2026-03-31T16:00:00.000Z',
    );

    const withPrivate = await service.timeline(owner, true, 'CAPTURED_AT', 'Asia/Shanghai');
    assert.equal(withPrivate.total, 3);
    assert.equal(withPrivate.months[0].count, 3);
    assert.equal(withPrivate.days.find((day) => day.date === '2026-03-09').count, 2);
  } finally {
    await db.eagleAsset.deleteMany({ where: { ownerId: owner } });
    await db.user.delete({ where: { id: owner } });
    await db.$disconnect();
  }
});

console.log('photo timeline timezone integration passed');
