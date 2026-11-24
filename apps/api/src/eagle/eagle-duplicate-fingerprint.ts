import sharp from 'sharp';
import { dhash64, type DuplicateFingerprint } from '@sekereagle/library-core';
export const DUPLICATE_FINGERPRINT_VERSION = 'preview-dhash-rgb-v1';
/** Current thumbnail only: never decode an unbounded original in the operation executor. */
export async function fingerprintPreview(bytes: Buffer): Promise<DuplicateFingerprint> {
  const image = sharp(bytes, { limitInputPixels: 4_000_000, failOn: 'warning' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb');
  const [gray, colors] = await Promise.all([
    image.clone().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer(),
    image.clone().resize(4, 4, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
  ]);
  const mean = gray.reduce((n, v) => n + v, 0) / gray.length;
  const contrast = Math.sqrt(gray.reduce((n, v) => n + (v - mean) ** 2, 0) / gray.length);
  return { hash: dhash64(gray), colors: [...colors], contrast };
}
