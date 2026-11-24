import type { EagleMediaJobKind } from '@prisma/client';

export const EDIT_RENDER_FRESH_MS = 60_000;

export interface WorkerHeartbeatView {
  workerId: string;
  heartbeatAt: Date;
  capabilities: unknown;
}

/** A dedicated NAS edit renderer is live; non-dedicated workers yield edit renders to it. */
export function dedicatedEditRendererOnline(
  rows: readonly WorkerHeartbeatView[],
  selfWorkerId: string,
  now = Date.now(),
): boolean {
  return rows.some((row) => {
    if (row.workerId === selfWorkerId) return false;
    if (now - row.heartbeatAt.getTime() > EDIT_RENDER_FRESH_MS) return false;
    const capabilities = row.capabilities as { editRendererDedicated?: unknown } | null;
    return capabilities?.editRendererDedicated === true;
  });
}

export function deferredJobKinds(online: boolean): readonly EagleMediaJobKind[] {
  return online ? ['RENDER_EDITED_COPY'] : [];
}
