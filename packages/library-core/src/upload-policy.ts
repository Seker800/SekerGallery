/** Files at or below this size upload as a single part. */
export const UPLOAD_TARGET_PART_SIZE_BYTES = 16 * 1024 * 1024;
/**
 * The Android backup transport rejects a session whose partSize is below 5 MiB,
 * so small single-part files keep this floor as well.
 */
export const UPLOAD_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

export function chooseUploadPartSize(size: number): number {
  // One part for ordinary photos keeps presign requests, round trips and NAS
  // object writes to one each. Larger media stays at 16 MiB, which also keeps
  // every part under the gateway's 32 MiB request limit and under 10,000 parts.
  if (size <= UPLOAD_TARGET_PART_SIZE_BYTES) return Math.max(UPLOAD_MIN_PART_SIZE_BYTES, size);
  return Math.max(UPLOAD_TARGET_PART_SIZE_BYTES, Math.ceil(size / 10000));
}
