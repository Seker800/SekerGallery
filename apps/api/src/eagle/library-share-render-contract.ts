/** Shared protocol values for the interactive share renderer. */
export const SHARE_RENDERER_ID = 'share-renderer';
export const SHARE_RENDER_CHANNEL = 'sekereagle_share_render';
export const SHARE_RENDER_MAX_ATTEMPTS = 2;
export const SHARE_RENDER_LEASE_MS = 5 * 60_000;
export const SHARE_RENDER_RETRY_DELAY_MS = 5_000;
export function shareRenderReadyRetentionMs(
  raw: string | undefined = process.env.EAGLE_SHARE_RENDER_RETENTION_MS,
) {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 60 * 60_000;
}
export const SHARE_RENDER_POLL_MS = 500;
export const SHARE_RENDER_HEARTBEAT_ONLINE_MS = 30_000;
