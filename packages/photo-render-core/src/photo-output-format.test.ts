import assert from 'node:assert/strict';
import test from 'node:test';
import { editedOutputFormat, watermarkCoversPhotoBackground } from './photo-output-format';

test('edited copies keep PNG and WebP sources and use JPEG for other formats', () => {
  assert.deepEqual(editedOutputFormat('image/png'), {
    format: 'png',
    extension: 'png',
    mimeType: 'image/png',
  });
  assert.deepEqual(editedOutputFormat('image/webp'), {
    format: 'webp',
    extension: 'webp',
    mimeType: 'image/webp',
  });
  for (const mimeType of [
    'image/jpeg',
    'image/heic',
    'image/tiff',
    'image/gif',
    'image/avif',
    'image/x-adobe-dng',
    null,
  ])
    assert.equal(editedOutputFormat(mimeType).format, 'jpeg');
});

test('a watermark that paints the whole background falls back to JPEG', () => {
  assert.equal(editedOutputFormat('image/png', true).format, 'jpeg');
  assert.equal(editedOutputFormat('image/webp', true).format, 'jpeg');
  assert.equal(editedOutputFormat('image/png', false).format, 'png');
});

test('only non-overlay watermarks cover the background', () => {
  assert.equal(watermarkCoversPhotoBackground('none'), false);
  assert.equal(watermarkCoversPhotoBackground(null), false);
  assert.equal(watermarkCoversPhotoBackground('standard-left'), false);
  assert.equal(watermarkCoversPhotoBackground('photo-strip'), true);
  assert.equal(watermarkCoversPhotoBackground('missing-template'), false);
});
