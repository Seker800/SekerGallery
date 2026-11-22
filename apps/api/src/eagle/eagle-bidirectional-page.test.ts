import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleService } from './eagle.service';
import { decodeEagleAssetCursor, encodeEagleAssetCursor } from './eagle-cursor';

test('jumped lists can prepend nearest newer rows without crossing owner, privacy or mode', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    const scope = { ownerId: 'owner', libraryMode: mode };
    const date = new Date('2026-01-02T00:00:00.000Z');
    let query: Record<string, unknown> = {};
    let rows = ['b', 'c', 'd'].map((id) => ({
      id,
      libraryAddedAt: date,
      chronologicalAt: date,
      renditions: [],
      manualTagLinks: [],
      byteSize: 0n,
      libraryMode: mode,
    }));
    const service = new EagleService(
      {
        eagleAsset: {
          findMany: async (input: Record<string, unknown>) => {
            query = input;
            return rows;
          },
        },
        eaglePhotoGroup: { findMany: async () => [] },
      } as never,
      undefined,
      mode,
    );
    const cursor = Buffer.from(
      JSON.stringify({
        v: 5,
        ...scope,
        sort: mode === 'PHOTO' ? 'CAPTURED_AT' : 'ADDED_AT',
        direction: 'NEWER',
        libraryAddedAt: date.toISOString(),
        id: 'a',
      }),
    ).toString('base64url');
    const result = await service.listAssets('owner', { limit: 2, cursor });
    assert.deepEqual(
      result.items.map((x) => x.id),
      ['c', 'b'],
    );
    assert.deepEqual(query.orderBy, [
      { [mode === 'PHOTO' ? 'chronologicalAt' : 'libraryAddedAt']: 'asc' },
      { id: 'asc' },
    ]);
    assert.equal(query.take, 3);
    const where = JSON.stringify(query.where);
    assert.match(where, /"ownerId":"owner"/);
    assert.match(where, /"isPrivate":false/);
    assert.match(where, /"deletedAt":null/);
    assert.match(where, /"gt":"a"/);
    const previous = (result as unknown as { previousCursor: string | null }).previousCursor;
    assert.equal(decodeEagleAssetCursor(previous!, scope).id, 'c');
    assert.equal(
      (decodeEagleAssetCursor(previous!, scope) as unknown as { direction: string }).direction,
      'NEWER',
    );
    assert.equal(decodeEagleAssetCursor(result.nextCursor!, scope).id, 'b');
    rows = rows.slice(0, 1);
    const end = await service.listAssets('owner', { limit: 2, cursor });
    assert.equal((end as unknown as { previousCursor: string | null }).previousCursor, null);
    const older = await service.listAssets('owner', {
      limit: 2,
      cursor: encodeEagleAssetCursor({ id: 'z', libraryAddedAt: date }, scope),
    });
    assert.ok((older as unknown as { previousCursor: string | null }).previousCursor);
    const head = await service.listAssets('owner', { limit: 2 });
    assert.equal((head as unknown as { previousCursor: string | null }).previousCursor, null);
  }
});

test('photo stack projection reports whether the group contains an edited copy', async () => {
  const date = new Date('2026-01-02T00:00:00.000Z');
  const rows = ['a', 'b'].map((id) => ({
    id,
    libraryAddedAt: date,
    chronologicalAt: date,
    createdAt: date,
    renditions: [],
    manualTagLinks: [],
    byteSize: 0n,
    libraryMode: 'PHOTO',
    lifecycleStatus: 'READY',
    mimeType: 'image/jpeg',
    photoMetadata: { captureMetadataInherited: id === 'b' },
  }));
  const group = {
    id: 'stack',
    bestAssetId: 'a',
    bestSelectedByUser: false,
    members: [
      {
        assetId: 'a',
        asset: {
          lifecycleStatus: 'READY',
          createdAt: date,
          chronologicalAt: date,
          mimeType: 'image/jpeg',
          photoMetadata: { captureMetadataInherited: false },
        },
      },
      {
        assetId: 'b',
        asset: {
          lifecycleStatus: 'READY',
          createdAt: date,
          chronologicalAt: date,
          mimeType: 'image/jpeg',
          photoMetadata: { captureMetadataInherited: true },
        },
      },
    ],
  };
  const service = new EagleService(
    {
      eagleAsset: { findMany: async () => rows },
      eaglePhotoGroup: { findMany: async () => [group] },
    } as never,
    undefined,
    'PHOTO',
  );
  const result = await service.listAssets('owner', { limit: 2 });
  assert.equal(result.photoStacks?.[0]?.hasEditedMember, true);
  assert.equal(result.photoStacks?.[0]?.bestAssetId, 'a');
});

test('timeline seek and offset windows expose a NEWER previous cursor', async () => {
  const date = new Date('2026-01-02T00:00:00.000Z');
  const rows = ['newer', 'older'].map((id) => ({
    id,
    libraryAddedAt: date,
    chronologicalAt: date,
    renditions: [],
    manualTagLinks: [],
    byteSize: 0n,
    libraryMode: 'MATERIAL',
  }));
  const service = new EagleService(
    {
      eagleAsset: { findMany: async () => rows },
      eaglePhotoGroup: { findMany: async () => [] },
    } as never,
    undefined,
    'MATERIAL',
  );
  const scope = { ownerId: 'owner', libraryMode: 'MATERIAL' as const };
  const result = await service.listAssets('owner', {
    limit: 1,
    before: '2020-01-01T00:00:00Z',
    offset: 1,
  });
  const previousCursor = (result as unknown as { previousCursor: string | null }).previousCursor;
  assert.ok(previousCursor);
  const previous = decodeEagleAssetCursor(previousCursor!, scope, 'ADDED_AT');
  assert.equal(previous.direction, 'NEWER');
  assert.equal(previous.id, 'newer');
  assert.ok(result.nextCursor);
  assert.equal(decodeEagleAssetCursor(result.nextCursor!, scope, 'ADDED_AT').id, 'newer');
});

test('offset-only refresh pages expose a NEWER previous cursor', async () => {
  const date = new Date('2026-01-02T00:00:00.000Z');
  const service = new EagleService(
    {
      eagleAsset: {
        findMany: async () => [
          {
            id: 'a',
            libraryAddedAt: date,
            chronologicalAt: date,
            renditions: [],
            manualTagLinks: [],
            byteSize: 0n,
            libraryMode: 'MATERIAL',
          },
        ],
      },
      eaglePhotoGroup: { findMany: async () => [] },
    } as never,
    undefined,
    'MATERIAL',
  );
  const result = await service.listAssets('owner', { limit: 60, offset: 1 });
  const previousCursor = (result as unknown as { previousCursor: string | null }).previousCursor;
  assert.ok(previousCursor);
  assert.equal(
    decodeEagleAssetCursor(
      previousCursor!,
      {
        ownerId: 'owner',
        libraryMode: 'MATERIAL',
      },
      'ADDED_AT',
    ).direction,
    'NEWER',
  );
});

test('first page and empty pages do not expose a previous cursor', async () => {
  const date = new Date('2026-01-02T00:00:00.000Z');
  const rows = [
    {
      id: 'a',
      libraryAddedAt: date,
      chronologicalAt: date,
      renditions: [],
      manualTagLinks: [],
      byteSize: 0n,
      libraryMode: 'MATERIAL',
    },
  ];
  let current = rows;
  const service = new EagleService(
    {
      eagleAsset: { findMany: async () => current },
      eaglePhotoGroup: { findMany: async () => [] },
    } as never,
    undefined,
    'MATERIAL',
  );
  const first = await service.listAssets('owner', { limit: 60 });
  assert.equal((first as unknown as { previousCursor: null }).previousCursor, null);
  current = [];
  const empty = await service.listAssets('owner', { limit: 60, before: '2020-01-01T00:00:00Z' });
  assert.equal((empty as unknown as { previousCursor: null }).previousCursor, null);
});

test('timeline seek still rejects cursor and search combinations', async () => {
  const service = new EagleService(
    {
      eagleAsset: { findMany: async () => [] },
      eaglePhotoGroup: { findMany: async () => [] },
    } as never,
    undefined,
    'MATERIAL',
  );
  await assert.rejects(() =>
    service.listAssets('owner', {
      limit: 60,
      before: '2020-01-01T00:00:00Z',
      cursor: 'old',
    }),
  );
  await assert.rejects(() =>
    service.listAssets('owner', {
      limit: 60,
      before: '2020-01-01T00:00:00Z',
      search: 'cat',
    }),
  );
});
