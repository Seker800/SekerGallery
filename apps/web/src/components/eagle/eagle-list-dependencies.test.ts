import { expect, it } from 'vitest';
import {
  metadataListMembershipSensitive,
  tagListMembershipSensitive,
} from './eagle-list-dependencies';

it('only treats metadata-sensitive views as membership-sensitive', () => {
  expect(metadataListMembershipSensitive({})).toBe(false);
  expect(metadataListMembershipSensitive({ sort: 'CAPTURED_AT' })).toBe(false);
  expect(metadataListMembershipSensitive({ manualTagIds: ['tag'] })).toBe(false);
  expect(metadataListMembershipSensitive({ search: '日落' })).toBe(true);
  expect(metadataListMembershipSensitive({ smartFolderId: 'folder' })).toBe(true);
  expect(
    metadataListMembershipSensitive({
      rules: [{ id: 'r', field: 'DESCRIPTION', operator: 'CONTAINS', value: 'x' }],
    }),
  ).toBe(true);
  expect(
    metadataListMembershipSensitive({
      rules: { operator: 'AND', children: [{ field: 'SOURCE_URL', operator: 'EMPTY' }] },
    }),
  ).toBe(true);
});

it('only treats tag-sensitive views as membership-sensitive', () => {
  expect(tagListMembershipSensitive({})).toBe(false);
  expect(tagListMembershipSensitive({ search: '日落' })).toBe(true);
  expect(tagListMembershipSensitive({ rating: 3 })).toBe(false);
  expect(tagListMembershipSensitive({ manualTagIds: ['tag'] })).toBe(true);
  expect(tagListMembershipSensitive({ smartFolderId: 'folder' })).toBe(true);
  expect(
    tagListMembershipSensitive({
      rules: [{ id: 'r', field: 'MANUAL_TAGS', operator: 'ALL_OF', value: ['tag'] }],
    }),
  ).toBe(true);
});
