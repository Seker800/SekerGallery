export interface RetryDelayOptions {
  baseMs: number;
  capMs: number;
  exponentCap?: number;
  exponentOffset?: number;
}

/** Shared exponential backoff; callers keep their own base, cap and attempt budget. */
export function retryDelayMs(attempts: number, options: RetryDelayOptions): number {
  const exponent = Math.max(0, attempts + (options.exponentOffset ?? 0));
  return Math.min(
    options.capMs,
    options.baseMs * 2 ** Math.min(exponent, options.exponentCap ?? Number.POSITIVE_INFINITY),
  );
}

/** One budget for clean failures and expired leases on the same build row. */
export const TAG_BUILD_FAILURE_LIMIT = 5;
