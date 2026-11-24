import { currentTimeZone, localDayKey } from '@sekereagle/library-core';
import type { EagleAssetListItem, EagleAssetSort, PhotoMetadata } from '../../lib/eagle-api';
import { getLocale } from '../../i18n';

type DatedAsset = Pick<EagleAssetListItem, 'chronologicalAt' | 'libraryAddedAt' | 'createdAt'> & {
  photoMetadata?: Pick<PhotoMetadata, 'capturedAt'> | null;
};

export function getPhotoTimelineDay(
  asset: DatedAsset,
  sort: EagleAssetSort = 'CAPTURED_AT',
  timeZone = currentTimeZone(),
): string | undefined {
  const candidates =
    sort === 'ADDED_AT'
      ? [asset.libraryAddedAt, asset.createdAt]
      : [
          asset.chronologicalAt,
          asset.photoMetadata?.capturedAt,
          asset.libraryAddedAt,
          asset.createdAt,
        ];
  const date = candidates.find((value) => value && Number.isFinite(Date.parse(value)));
  return date ? localDayKey(date!, timeZone) : undefined;
}

export function createPhotoTimelineSectionKeys(
  assets: readonly (DatedAsset & { id: string })[],
  sort: EagleAssetSort = 'CAPTURED_AT',
  timeZone = currentTimeZone(),
) {
  return new Map(
    assets.flatMap((asset) => {
      const month = getPhotoTimelineMonth(asset, sort, timeZone);
      return month ? [[asset.id, month] as const] : [];
    }),
  );
}

export function formatPhotoTimelineMonth(month: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function getPhotoTimelineMonth(
  asset: DatedAsset,
  sort: EagleAssetSort = 'CAPTURED_AT',
  timeZone = currentTimeZone(),
): string | undefined {
  return getPhotoTimelineDay(asset, sort, timeZone)?.slice(0, 7);
}
export function createPhotoTimelineDayKeys(
  assets: readonly (DatedAsset & { id: string })[],
  sort: EagleAssetSort = 'CAPTURED_AT',
  timeZone = currentTimeZone(),
) {
  return new Map(
    assets.flatMap((asset) => {
      const day = getPhotoTimelineDay(asset, sort, timeZone);
      return day ? [[asset.id, day] as const] : [];
    }),
  );
}
export function formatPhotoTimelineDay(day: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
