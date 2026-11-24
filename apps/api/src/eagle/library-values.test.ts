import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleAssetWhere } from './library-values';

test('visible asset variants keep owner, mode and privacy explicit', () => {
  assert.deepEqual(visibleAssetWhere('owner', 'PHOTO', false), {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    isPrivate: false,
    deletedAt: null,
  });
  assert.deepEqual(visibleAssetWhere('owner', 'MATERIAL', true, 'media'), {
    ownerId: 'owner',
    libraryMode: 'MATERIAL',
    purgeAfter: null,
  });
  assert.deepEqual(visibleAssetWhere('owner', 'PHOTO', false, 'trash'), {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    isPrivate: false,
    deletedAt: { not: null },
    purgeAfter: null,
  });
});

test('frozen task scope keeps transferred members visible', () => {
  assert.deepEqual(visibleAssetWhere('owner', 'PHOTO', false, 'frozen-task'), {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    isPrivate: false,
    deletedAt: null,
    OR: [{ purgeAfter: null }, { transferredAt: { not: null } }],
  });
});
