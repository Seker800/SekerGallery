import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOwnedObjectKey,
  createAssetObjectKey,
  editedCopyKey,
  mediaOutputPrefix,
} from './object-keys';

const owner = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
const asset = '13e84291-8ad7-4c44-aa76-29a45ce058b2';
const attempt = 'f1b5c0de-49c6-4a1a-9b5b-6f25d9f5b3c2';

test('asset keys keep the existing owner-scoped shape and suffix cleanup', () => {
  assert.match(
    createAssetObjectKey(owner, '猫.jpg'),
    new RegExp(`^users/${owner}/assets/[0-9a-f-]{36}/jpg$`),
  );
  assert.match(
    createAssetObjectKey(owner, 'a b.CR3'),
    new RegExp(`^users/${owner}/assets/[0-9a-f-]{36}/a-b.cr3$`),
  );
  assert.throws(() => createAssetObjectKey('not-a-uuid', 'a.jpg'));
  assert.throws(() => createAssetObjectKey(owner, '..'));
});

test('derived keys are built from the same owner and asset scope', () => {
  assert.equal(
    mediaOutputPrefix(owner, asset, 'renditions', 3, attempt),
    `users/${owner}/assets/${asset}/renditions/3/attempts/${attempt}/`,
  );
  assert.equal(editedCopyKey(owner, asset, 'webp'), `users/${owner}/assets/${asset}/original.webp`);
  assert.throws(() => editedCopyKey(owner, asset, 'jpeg'));
});

test('ownership assertions reject traversal, separators and foreign owners', () => {
  for (const key of [
    `users/${owner}/assets/${asset}/original.jpg`,
    `users/${owner}/assets/${asset}/renditions/1/attempts/${attempt}/`,
  ])
    assert.doesNotThrow(() => assertOwnedObjectKey(owner, key));
  for (const key of [
    `users/${attempt}/assets/${asset}/original.jpg`,
    `users/${owner}/assets/../original.jpg`,
    `users/${owner}/assets/./original.jpg`,
    `users/${owner}//assets/original.jpg`,
    `users/${owner}/assets\\original.jpg`,
    `users/${owner}/assets/original.jpg\0`,
    `users/${owner}/assets/${'a'.repeat(1100)}`,
  ])
    assert.throws(() => assertOwnedObjectKey(owner, key), /对象|对象键不安全/);
});
