import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { LibraryManualTagService } from './library-manual-tag.service';

test('manual tag creation marks reserved tag names with stable system keys', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = new LibraryManualTagService(
    {
      eagleManualTag: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push(data);
          return {
            id: 'tag',
            name: data.name,
            color: null,
            systemKey: data.systemKey,
            isStarred: false,
            lastUsedAt: null,
            rowVersion: 1,
          };
        },
      },
    } as never,
    'PHOTO',
  );
  const favorite = await service.createManualTag('owner', { name: '收藏' });
  const edited = await service.createManualTag('owner', { name: '已编辑' });
  const ordinary = await service.createManualTag('owner', { name: '旅行' });
  assert.equal(favorite.systemKey, 'FAVORITE');
  assert.equal(edited.systemKey, 'EDIT_COPY');
  assert.equal(ordinary.systemKey, null);
  assert.deepEqual(
    writes.map((row) => row.systemKey),
    ['FAVORITE', 'EDIT_COPY', null],
  );
});

test('system tags cannot be renamed into another system or ordinary name', async () => {
  const service = new LibraryManualTagService(
    {
      eagleManualTag: {
        findFirst: async () => ({
          id: 'tag',
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          name: '收藏',
          normalizedName: '收藏',
          systemKey: 'FAVORITE',
          rowVersion: 1,
          groupId: null,
          isStarred: false,
          color: null,
          marksAssetsPrivate: false,
        }),
      },
    } as never,
    'PHOTO',
  );
  await assert.rejects(
    () =>
      service.updateManualTag('owner', 'tag', {
        rowVersion: 1,
        name: '我的收藏',
      }),
    (reason: unknown) => reason instanceof ConflictException,
  );
});

test('reserved names stay protected when an older runtime created them without a key', async () => {
  const tag = {
    id: 'tag',
    name: '收藏',
    normalizedName: '收藏',
    systemKey: null,
    color: null,
    marksAssetsPrivate: false,
    groupId: null,
    groupMemberships: [],
    isStarred: false,
    lastUsedAt: null,
    rowVersion: 2,
    _count: { assetLinks: 1 },
  };
  const service = new LibraryManualTagService(
    {
      eagleManualTag: {
        findMany: async () => [tag],
        findFirst: async () => tag,
      },
      $queryRaw: async () => [],
    } as never,
    'MATERIAL',
  );
  const [listed] = await service.listManualTags('owner', false);
  assert.ok(listed);
  assert.equal(listed.systemKey, 'FAVORITE');
  await assert.rejects(
    () => service.updateManualTag('owner', 'tag', { rowVersion: 2, name: '旅行' }),
    (reason: unknown) => reason instanceof ConflictException,
  );
  await assert.rejects(
    () => service.deleteManualTag('owner', 'tag'),
    (reason: unknown) => reason instanceof ConflictException,
  );
});
