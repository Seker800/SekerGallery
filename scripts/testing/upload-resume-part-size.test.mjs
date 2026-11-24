import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createPrismaAdapter } from '../../packages/library-persistence/dist/index.js';
import { EagleUploadService } from '../../apps/api/dist/eagle/eagle-upload.service.js';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
});
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');

const OWNER = randomUUID();
const PART_SIZE = 16 * 1024 * 1024;
const FILE_SIZE = 17 * 1024 * 1024;

function service(db, storage) {
  return new EagleUploadService(db, storage, {}, {}, 'PHOTO');
}

test('resumed multi-part uploads return and validate the persisted part size', async () => {
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  const sessionId = randomUUID();
  try {
    await db.user.create({
      data: { id: OWNER, email: `${OWNER}@example.invalid`, passwordHash: 'synthetic' },
    });
    await db.$executeRaw`
      INSERT INTO "UploadSession"
        (id,"uploaderId","libraryMode",status,"originalName","mimeType",size,"partSize","objectKey","multipartUploadId","updatedAt")
      VALUES (${sessionId},${OWNER},'PHOTO'::"LibraryMode",'INITIATED','photo.jpg','image/jpeg',${FILE_SIZE},${PART_SIZE},
        ${`users/${OWNER}/assets/${sessionId}/photo.jpg`},'synthetic',now())
    `;

    const session = await service(db, {}).getSession(OWNER, sessionId);
    assert.equal(session.partSizeBytes, PART_SIZE);

    const listed = await service(db, {
      listMultipartUploadParts: async () => [
        { partNumber: 1, etag: '"first"', size: PART_SIZE },
        { partNumber: 2, etag: '"second"', size: FILE_SIZE - PART_SIZE },
      ],
    }).listParts(OWNER, sessionId);
    assert.equal(listed.partSizeBytes, PART_SIZE);
    assert.equal(listed.status, 'INITIATED');
    assert.deepEqual(
      listed.parts.map((part) => [part.partNumber, part.size]),
      [
        [1, PART_SIZE],
        [2, FILE_SIZE - PART_SIZE],
      ],
    );

    await assert.rejects(
      service(db, {
        listMultipartUploadParts: async () => [
          { partNumber: 1, etag: '"wrong"', size: 5 * 1024 * 1024 },
        ],
      }).listParts(OWNER, sessionId),
      /分片大小不一致/,
    );
  } finally {
    await db.uploadSession.deleteMany({ where: { uploaderId: OWNER } });
    await db.user.delete({ where: { id: OWNER } });
    await db.$disconnect();
  }
});

console.log('upload resume part-size integration passed');
