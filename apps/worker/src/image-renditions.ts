import type { CameraDimensions, ImageRenditionSpec } from '@sekereagle/media-core';
import { imageRenditionSpecs } from '@sekereagle/media-core';
import sharp, { type Sharp } from 'sharp';

export { imageRenditionSpecs };
export type { ImageRenditionSpec };

export function catalogImageDimensions(
  decoded: { width?: number; height?: number; autoOrient?: { width: number; height: number } },
  original?: CameraDimensions,
) {
  return {
    width: original?.width ?? decoded.autoOrient?.width ?? decoded.width,
    height: original?.height ?? decoded.autoOrient?.height ?? decoded.height,
  };
}

/** Camera previews are display thumbnails, never an editing source. */
export function renditionSource<T>(
  spec: Pick<ImageRenditionSpec, 'kind'>,
  developed: T,
  embeddedThumbnail?: T,
): T {
  return spec.kind === 'THUMBNAIL' ? (embeddedThumbnail ?? developed) : developed;
}

/** Only the normal browse repair may reuse published outputs; explicit refreshes remain explicit. */
export function canReuseImageBrowsing(
  job: { kind: string; processorVersion: string; assetRevision: number },
  asset: {
    lifecycleStatus: string;
    sha256: string | null;
    width: number | null;
    height: number | null;
    renditions: Array<{ kind: string; variant?: string; revision: number; status?: string }>;
  },
): boolean {
  return (
    job.kind === 'GENERATE_RENDITIONS' &&
    job.processorVersion === 'rendition-v2' &&
    asset.lifecycleStatus === 'READY' &&
    Boolean(asset.sha256 && asset.width && asset.height) &&
    [
      ['PREVIEW', 'default'],
      ['THUMBNAIL', '256'],
      ['THUMBNAIL', '512'],
    ].every(([kind, variant]) =>
      asset.renditions.some(
        (r) =>
          r.kind === kind &&
          r.variant === variant &&
          r.revision === job.assetRevision &&
          r.status === 'READY',
      ),
    )
  );
}

/** Decode/orient the full source once; all browse encoders consume bounded raw pixels. */
export async function renderImageRenditions(
  source: Sharp,
  mimeType: string,
  purpose: 'BROWSE' | 'DETAILS',
) {
  const specs = imageRenditionSpecs(mimeType, purpose);
  if (!specs.length) return [];
  const browse =
    purpose === 'BROWSE'
      ? await source
          .clone()
          .rotate()
          .toColourspace('srgb')
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .raw()
          .toBuffer({ resolveWithObject: true })
      : null;
  const rendered = [];
  for (const spec of specs) {
    const image = browse
      ? sharp(browse.data, {
          raw: {
            width: browse.info.width,
            height: browse.info.height,
            channels: browse.info.channels,
          },
        })
      : source.clone().rotate();
    rendered.push({
      spec,
      output: await image
        .resize({
          width: spec.maxSize,
          height: spec.maxSize,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp(spec.encoding)
        .toBuffer({ resolveWithObject: true }),
    });
  }
  return rendered;
}
