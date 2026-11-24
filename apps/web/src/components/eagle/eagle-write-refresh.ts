import type { QueryClient } from '@tanstack/react-query';
import { invalidateDesktopAssetsAndRefresh } from '../../lib/desktop-cache';
import { eagleAssetListFilters, isEagleAssetListShape } from '../../lib/eagle-query-key-shape';
import { isEagleAssetDetailKey, type createEagleQueryKeys } from './eagle-query-keys';
import { tagListMembershipSensitive } from './eagle-list-dependencies';

/** Tag writes refresh tag-sensitive membership and counts, not every cached list. */
export function refreshEagleAssetRelations(
  client: QueryClient,
  keys: ReturnType<typeof createEagleQueryKeys>,
  assetIds: readonly string[],
  options: { refreshLists?: boolean } = {},
) {
  const listPredicate = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[0] === 'eagle' &&
    query.queryKey[1] === keys.root[1] &&
    query.queryKey[2] === keys.root[2] &&
    isEagleAssetListShape(query.queryKey) &&
    (options.refreshLists === true ||
      tagListMembershipSensitive(eagleAssetListFilters(query.queryKey)));
  const affected = new Set(assetIds);
  const ownerId = keys.root[1] ?? '';
  const mode = String(keys.root[2]);
  const detailPredicate = (query: { queryKey: readonly unknown[] }) =>
    isEagleAssetDetailKey(query.queryKey, ownerId, mode) && affected.has(String(query.queryKey[4]));
  return invalidateDesktopAssetsAndRefresh(assetIds, () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.manualTags }),
      client.invalidateQueries({ queryKey: keys.manualTagGroups }),
      client.invalidateQueries({ queryKey: keys.smartFolders }),
      client.invalidateQueries({ queryKey: [...keys.root, 'vector-summary'] }),
      client.invalidateQueries({ predicate: listPredicate }),
      client.invalidateQueries({ predicate: detailPredicate }),
    ]),
  );
}

/** A newly published copy invalidates only mounted lists plus the facts that changed globally. */
export function refreshAfterNewAsset(
  client: QueryClient,
  keys: ReturnType<typeof createEagleQueryKeys>,
) {
  return Promise.all([
    // Mark every cached list stale without refetching unmounted ones; mounted lists
    // are refetched below so the new asset appears in the current view.
    client.invalidateQueries({ queryKey: keys.assets, refetchType: 'none' }),
    ...client
      .getQueryCache()
      .findAll({ queryKey: keys.assets, type: 'active' })
      .map((query) => client.invalidateQueries({ queryKey: query.queryKey, exact: true })),
    client.invalidateQueries({ queryKey: keys.manualTags }),
    client.invalidateQueries({ queryKey: keys.smartFolders }),
    client.invalidateQueries({ queryKey: keys.libraryCounts }),
  ]);
}
