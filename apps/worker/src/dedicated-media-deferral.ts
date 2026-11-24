import type { EagleMediaJobKind } from '@prisma/client';

export const DEDICATED_MEDIA_FRESH_MS = 60_000;

export interface WorkerHeartbeatView {
  workerId: string;
  heartbeatAt: Date;
  capabilities: unknown;
}

/**
 * Kinds a fresh dedicated media node (always-on NAS) currently owns. Other
 * workers keep these kinds out of their claim passes until its heartbeat expires.
 */
export function dedicatedMediaKindsOnline(
  rows: readonly WorkerHeartbeatView[],
  selfWorkerId: string,
  now = Date.now(),
): Set<EagleMediaJobKind> {
  const kinds = new Set<EagleMediaJobKind>();
  for (const row of rows) {
    if (row.workerId === selfWorkerId) continue;
    if (now - row.heartbeatAt.getTime() > DEDICATED_MEDIA_FRESH_MS) continue;
    const capabilities = row.capabilities as { dedicatedMediaKinds?: unknown } | null;
    if (!Array.isArray(capabilities?.dedicatedMediaKinds)) continue;
    for (const kind of capabilities.dedicatedMediaKinds)
      if (typeof kind === 'string') kinds.add(kind as EagleMediaJobKind);
  }
  return kinds;
}

export function deferredJobKinds(
  onlineKinds: ReadonlySet<EagleMediaJobKind>,
  allowedKinds?: readonly EagleMediaJobKind[],
): readonly EagleMediaJobKind[] {
  const allowed = allowedKinds ? new Set(allowedKinds) : null;
  return [...onlineKinds].filter((kind) => !allowed || allowed.has(kind));
}

/** A dedicated node must state exactly what it takes; model work stays on the fleet. */
export function assertDedicatedMediaNodeConfig(
  dedicated: boolean,
  configuredKinds: readonly EagleMediaJobKind[] | undefined,
): void {
  if (!dedicated) return;
  if (!configuredKinds?.length)
    throw new Error(
      'EAGLE_DEDICATED_MEDIA_NODE requires an explicit EAGLE_PROCESSING_JOB_KINDS list',
    );
  if (
    configuredKinds.includes('GENERATE_EMBEDDING') ||
    configuredKinds.includes('GENERATE_AI_TAGS')
  )
    throw new Error('A dedicated media node cannot claim model work (embeddings or AI tags)');
}
