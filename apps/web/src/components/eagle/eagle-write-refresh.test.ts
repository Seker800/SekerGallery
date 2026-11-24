import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createEagleQueryKeys } from './eagle-query-keys';
import { refreshAfterNewAsset, refreshEagleAssetRelations } from './eagle-write-refresh';
import { makeEagleAsset } from '../../test/eagle-fixtures';
it.each(['MATERIAL', 'PHOTO'] as const)(
  'relationship writes refresh tag-sensitive membership and counts in %s',
  async (mode) => {
    const client = new QueryClient();
    const keys = createEagleQueryKeys('owner', mode);
    const affected = [
      keys.assetList('ACTIVE', { manualTagIds: ['t'] }),
      keys.assetList('ACTIVE', { search: 'sunset' }),
      keys.assetDetail('a', 'ACTIVE'),
      keys.manualTags,
      keys.manualTagGroups,
      keys.smartFolders,
      [...keys.root, 'vector-summary'],
    ];
    const unaffected = [keys.assetList('ACTIVE', {})];
    [...affected, ...unaffected].forEach((key) => client.setQueryData(key, makeEagleAsset()));
    const otherOwner = createEagleQueryKeys('other', mode).assetList('ACTIVE', {
      manualTagIds: ['t'],
    });
    const otherMode = createEagleQueryKeys(
      'owner',
      mode === 'MATERIAL' ? 'PHOTO' : 'MATERIAL',
    ).assetList('ACTIVE', { manualTagIds: ['t'] });
    [otherOwner, otherMode].forEach((key) => client.setQueryData(key, makeEagleAsset()));
    await refreshEagleAssetRelations(client, keys, ['a']);
    affected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    unaffected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
    [otherOwner, otherMode].forEach((key) =>
      expect(client.getQueryState(key)?.isInvalidated).toBe(false),
    );
    client.clear();
  },
);
it('marks inactive cached lists stale when a new asset is published', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('owner', 'MATERIAL');
  const inactive = keys.assetList('ACTIVE', { search: 'sunset' });
  client.setQueryData(inactive, makeEagleAsset());
  await refreshAfterNewAsset(client, keys);
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
  client.clear();
});

it('desktop invalidation failure cannot prevent query refresh', async () => {
  const client = new QueryClient(),
    keys = createEagleQueryKeys('owner');
  client.setQueryData(keys.manualTags, []);
  vi.stubGlobal('sekerDesktop', {
    version: 1,
    createMediaUrl: vi.fn(),
    getCacheStatus: vi.fn(),
    setCacheLimitGiB: vi.fn(),
    clearCache: vi.fn(),
    invalidateAsset: vi.fn().mockRejectedValue(new Error('disk failure')),
  });
  try {
    await expect(refreshEagleAssetRelations(client, keys, ['a'])).rejects.toThrow('disk failure');
    expect(client.getQueryState(keys.manualTags)?.isInvalidated).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    client.clear();
  }
});
