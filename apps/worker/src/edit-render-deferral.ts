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

/** A dedicated node that also claims other kinds would defeat the yield rule. */
export function assertDedicatedEditRendererConfig(
  dedicated: boolean,
  configuredKinds: readonly string[] | undefined,
): void {
  if (!dedicated) return;
  if (configuredKinds?.length === 1 && configuredKinds[0] === 'RENDER_EDITED_COPY') return;
  throw new Error(
    'EAGLE_EDIT_RENDERER_DEDICATED requires EAGLE_PROCESSING_JOB_KINDS=RENDER_EDITED_COPY only',
  );
}
