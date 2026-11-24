import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Two real resource boundaries share the same process-wide inspection budget:
 * `transfer` streams the original to disk and hashes it (NAS egress/disk I/O),
 * `decode` parses headers/metadata (bounded memory). Only the transfer phase
 * needs more than one slot; decode stays effectively serialized.
 */
export interface MediaInspectionGates {
  transfer<T>(work: () => Promise<T>): Promise<T>;
  decode<T>(work: () => Promise<T>): Promise<T>;
}

type GateKind = 'transfer' | 'decode';

const GATE_LIMITS = {
  transfer: {
    variable: 'EAGLE_UPLOAD_INSPECTION_TRANSFER_CONCURRENCY',
    fallback: 2,
    maximum: 8,
  },
  decode: {
    variable: 'EAGLE_UPLOAD_INSPECTION_DECODE_CONCURRENCY',
    fallback: 1,
    maximum: 2,
  },
} as const;

/** Invalid or out-of-range overrides fall back instead of failing the whole upload path. */
export function inspectionConcurrency(
  kind: GateKind,
  raw: string | undefined = process.env[GATE_LIMITS[kind].variable],
): number {
  const { fallback, maximum } = GATE_LIMITS[kind];
  const parsed = Number(raw ?? '');
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

/**
 * The executor may claim this many finalizations at once: each one can hold a
 * transfer slot, while the shared decode gate still bounds Sharp/subprocess work.
 */
export function uploadInspectionTransferConcurrency(
  raw: string | undefined = process.env[GATE_LIMITS.transfer.variable],
): number {
  return inspectionConcurrency('transfer', raw);
}

export class MediaInspectionBudget {
  private readonly limits: Record<GateKind, number>;
  private readonly active: Record<GateKind, number> = { transfer: 0, decode: 0 };
  private readonly waitingQueues: Record<GateKind, Array<() => void>> = {
    transfer: [],
    decode: [],
  };
  private waiting = 0;
  private readonly owners = new Map<string, number>();

  constructor(
    options: {
      transferConcurrency?: number;
      decodeConcurrency?: number;
    } = {},
  ) {
    const transfer = options.transferConcurrency;
    const decode = options.decodeConcurrency;
    this.limits = {
      transfer:
        Number.isSafeInteger(transfer) &&
        transfer! >= 1 &&
        transfer! <= GATE_LIMITS.transfer.maximum
          ? transfer!
          : inspectionConcurrency('transfer'),
      decode:
        Number.isSafeInteger(decode) && decode! >= 1 && decode! <= GATE_LIMITS.decode.maximum
          ? decode!
          : inspectionConcurrency('decode'),
    };
  }

  async run<T>(owner: string, work: (gates: MediaInspectionGates) => Promise<T>): Promise<T> {
    // A user may occupy at most the shared transfer width; the global gate still
    // bounds real NAS/decoder resources.
    if (this.waiting >= 32 || (this.owners.get(owner) ?? 0) >= Math.max(4, this.limits.transfer))
      throw new ServiceUnavailableException('媒体检查繁忙，请稍后重试。');
    this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1);
    try {
      return await work({
        transfer: (task) => this.acquire('transfer', task),
        decode: (task) => this.acquire('decode', task),
      });
    } finally {
      const count = this.owners.get(owner)! - 1;
      if (count) this.owners.set(owner, count);
      else this.owners.delete(owner);
    }
  }

  private async acquire<T>(kind: GateKind, work: () => Promise<T>): Promise<T> {
    if (this.active[kind] >= this.limits[kind]) {
      this.waiting++;
      try {
        await new Promise<void>((resolve) => this.waitingQueues[kind].push(resolve));
      } finally {
        this.waiting--;
      }
    } else {
      this.active[kind]++;
    }
    try {
      return await work();
    } finally {
      const next = this.waitingQueues[kind].shift();
      // A resolved waiter inherits the slot; only the last release closes it.
      if (next) next();
      else this.active[kind]--;
    }
  }
}
export const mediaInspectionBudget = new MediaInspectionBudget();
