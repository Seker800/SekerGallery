import { findWatermark } from './photo-watermark-model';

export type EditedPhotoFormat = 'png' | 'jpeg' | 'webp';
export interface EditedPhotoOutput {
  format: EditedPhotoFormat;
  extension: 'png' | 'jpg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

const PNG: EditedPhotoOutput = { format: 'png', extension: 'png', mimeType: 'image/png' };
const JPEG: EditedPhotoOutput = { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
const WEBP: EditedPhotoOutput = { format: 'webp', extension: 'webp', mimeType: 'image/webp' };

/**
 * Keep the source container when it can carry the result. A watermark that fills
 * the whole background removes transparency, so those copies use JPEG.
 */
export function editedOutputFormat(
  sourceMimeType: string | null | undefined,
  watermarkCoversBackground = false,
): EditedPhotoOutput {
  if (!watermarkCoversBackground) {
    const mimeType = sourceMimeType?.trim().toLowerCase();
    if (mimeType === 'image/png') return PNG;
    if (mimeType === 'image/webp') return WEBP;
  }
  return JPEG;
}

/** Non-overlay watermarks paint a full background (white, dark or frosted). */
export function watermarkCoversPhotoBackground(watermarkId: string | null | undefined): boolean {
  const template = watermarkId ? findWatermark(watermarkId) : undefined;
  return Boolean(template && !template.overlay);
}
