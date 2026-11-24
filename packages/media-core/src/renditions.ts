import { CAMERA_RAW_EDIT_MAX_SIZE, isCameraRawMime } from '@sekereagle/library-core';

export interface ImageRenditionEncoding {
  quality?: number;
  lossless?: boolean;
}

export interface ImageRenditionSpec {
  kind: 'PREVIEW' | 'THUMBNAIL';
  variant: string;
  maxSize: number;
  encoding: ImageRenditionEncoding;
}

/** One rendition policy for materials and photos, independent of job orchestration. */
export function imageRenditionSpecs(
  mimeType: string,
  purpose: 'ALL' | 'BROWSE' | 'DETAILS' = 'ALL',
): ImageRenditionSpec[] {
  const specs: ImageRenditionSpec[] = [
    { kind: 'PREVIEW', variant: 'default', maxSize: 1600, encoding: { quality: 86 } },
    { kind: 'THUMBNAIL', variant: '256', maxSize: 256, encoding: { quality: 78 } },
    { kind: 'THUMBNAIL', variant: '512', maxSize: 512, encoding: { quality: 78 } },
  ];
  if (isCameraRawMime(mimeType))
    specs.push({
      kind: 'PREVIEW',
      variant: 'edit',
      maxSize: CAMERA_RAW_EDIT_MAX_SIZE,
      encoding: { lossless: true },
    });
  return specs.filter(
    (spec) =>
      purpose === 'ALL' ||
      (purpose === 'DETAILS' ? spec.variant === 'edit' : spec.variant !== 'edit'),
  );
}
