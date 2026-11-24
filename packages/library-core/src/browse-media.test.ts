import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRenditionForWidth } from './browse-media';

const rows = [
  { id: 'small', kind: 'THUMBNAIL', revision: 3, variant: '256', width: 256, mimeType: 'image/webp' },
  { id: 'large', kind: 'THUMBNAIL', revision: 3, variant: '512', width: 512, mimeType: 'image/webp' },
  { id: 'edit', kind: 'PREVIEW', revision: 3, variant: 'edit', width: 6000, mimeType: 'image/webp' },
  { id: 'old', kind: 'THUMBNAIL', revision: 2, variant: '256', width: 256, mimeType: 'image/webp' },
  { id: 'video', kind: 'THUMBNAIL', revision: 3, variant: '512', width: 512, mimeType: 'video/mp4' },
];

test('rendition selection picks the smallest covering width for the current revision', () => {
  assert.equal(selectRenditionForWidth(rows, 3, 'THUMBNAIL', 128)?.id, 'small');
  assert.equal(selectRenditionForWidth(rows, 3, 'THUMBNAIL', 256)?.id, 'small');
  assert.equal(selectRenditionForWidth(rows, 3, 'THUMBNAIL', 300)?.id, 'large');
  assert.equal(selectRenditionForWidth(rows, 3, 'THUMBNAIL', 2048)?.id, 'large');
});

test('rendition selection excludes edits, stale revisions and non-image media', () => {
  assert.equal(selectRenditionForWidth(rows, 3, 'PREVIEW', 6000)?.id, undefined);
  assert.equal(selectRenditionForWidth(rows, 3, 'THUMBNAIL', 1)?.id, 'small');
  assert.equal(selectRenditionForWidth([], 3, 'THUMBNAIL', 256), undefined);
});
