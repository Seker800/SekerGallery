import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { LibraryManualTagService } from './library-manual-tag.service';

const target = {
  id: 'target',
  name: '旅行',
  normalizedName: '旅行',
  systemKey: null,
  marksAssetsPrivate: false,
};
const source = {
  id: 'source',
  name: '海边',
  normalizedName: '海边',
  systemKey: null,
  marksAssetsPrivate: false,
};

function serviceWith(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
  };
  return new LibraryManualTagService(prisma as never, 'MATERIAL');
}

test('tag merge validates once, repoints AI promotions and writes the target links', async () => {
  const writes: string[] = [];
  const tx = {
    $queryRaw: async () => [{ scanned: 0, matched: 0 }],
    eagleManualTag: {
      findMany: async () => [target, source],
      updateMany: async () => {
        writes.push('touch-target');
        return { count: 1 };
      },
      deleteMany: async () => {
        writes.push('delete-tags');
        return { count: 1 };
      },
    },
    eagleSmartFolderManualTagDependency: { findFirst: async () => null },
    eagleAssetManualTag: {
      count: async () => 0,
      findMany: async () => [{ assetId: 'asset-a' }, { assetId: 'asset-b' }],
      createMany: async (input: { data: unknown[] }) => {
        writes.push(`create-links:${input.data.length}`);
        return { count: input.data.length };
      },
      deleteMany: async () => {
        writes.push('delete-source-links');
        return { count: 2 };
      },
    },
    eagleAssetAiTag: {
      updateMany: async () => {
        writes.push('repoint-ai');
        return { count: 0 };
      },
    },
  };
  const service = serviceWith(tx);
  const result = await service.mergeManualTags(
    'owner',
    { sourceTagIds: ['source'], targetTagId: 'target' },
    false,
  );
  assert.deepEqual(result, {
    targetTagId: 'target',
    mergedTagIds: ['source'],
    assetCount: 2,
    privacyChangedAssetCount: 0,
  });
  assert.deepEqual(writes, [
    'touch-target',
    'repoint-ai',
    'create-links:2',
    'delete-source-links',
    'delete-tags',
  ]);
});

test('tag merge rejects smart-folder dependencies before any write', async () => {
  const writes: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    eagleManualTag: {
      findMany: async () => [target, source],
      updateMany: async () => {
        writes.push('touch-target');
        return { count: 1 };
      },
      deleteMany: async () => {
        writes.push('delete-tags');
        return { count: 1 };
      },
    },
    eagleSmartFolderManualTagDependency: {
      findFirst: async () => ({ smartFolderId: 'folder' }),
    },
    eagleAssetManualTag: {
      count: async () => 0,
      findMany: async () => [{ assetId: 'asset-a' }],
      createMany: async () => {
        writes.push('create-links');
        return { count: 1 };
      },
      deleteMany: async () => {
        writes.push('delete-source-links');
        return { count: 1 };
      },
    },
    eagleAssetAiTag: { updateMany: async () => ({ count: 0 }) },
  };
  const service = serviceWith(tx);
  await assert.rejects(
    service.mergeManualTags('owner', { sourceTagIds: ['source'], targetTagId: 'target' }, false),
    (error: unknown) => error instanceof ConflictException && /智能文件夹/.test(error.message),
  );
  assert.deepEqual(writes, []);
});

test('tag merge hides private links from callers without private visibility', async () => {
  const writes: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    eagleManualTag: {
      findMany: async () => [target, source],
      updateMany: async () => {
        writes.push('touch-target');
        return { count: 1 };
      },
      deleteMany: async () => {
        writes.push('delete-tags');
        return { count: 1 };
      },
    },
    eagleSmartFolderManualTagDependency: { findFirst: async () => null },
    eagleAssetManualTag: {
      count: async () => 1,
      findMany: async () => [{ assetId: 'asset-a' }],
      createMany: async () => {
        writes.push('create-links');
        return { count: 1 };
      },
      deleteMany: async () => {
        writes.push('delete-source-links');
        return { count: 1 };
      },
    },
    eagleAssetAiTag: { updateMany: async () => ({ count: 0 }) },
  };
  const service = serviceWith(tx);
  await assert.rejects(
    service.mergeManualTags('owner', { sourceTagIds: ['source'], targetTagId: 'target' }, false),
    (error: unknown) => error instanceof ConflictException && /私密素材/.test(error.message),
  );
  assert.deepEqual(writes, []);
});

test('tag merge refuses reserved system tags', async () => {
  const tx = {
    $queryRaw: async () => [],
    eagleManualTag: {
      findMany: async () => [target, { ...source, systemKey: 'FAVORITE' }],
    },
  };
  const service = serviceWith(tx);
  await assert.rejects(
    service.mergeManualTags('owner', { sourceTagIds: ['source'], targetTagId: 'target' }, false),
    (error: unknown) => error instanceof ConflictException && /系统标签/.test(error.message),
  );
});

test('merge DTO derives nothing from the client except tag ids', async () => {
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');
  const { MergeEagleManualTagsDto } = await import('./eagle.dto');
  const target = '11111111-1111-4111-8111-111111111111';
  const source = '22222222-2222-4222-8222-222222222222';
  assert.equal(
    (
      await validate(
        plainToInstance(MergeEagleManualTagsDto, { targetTagId: target, sourceTagIds: [source] }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
    ).length,
    0,
  );
  for (const input of [
    { targetTagId: target, sourceTagIds: [], ownerId: 'foreign' },
    { targetTagId: 'not-a-uuid', sourceTagIds: [source] },
    { targetTagId: target, sourceTagIds: ['not-a-uuid'] },
    { targetTagId: target, sourceTagIds: [source], ownerId: 'foreign' },
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(MergeEagleManualTagsDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  }
});
