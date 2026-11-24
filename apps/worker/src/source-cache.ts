import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SOURCE_CACHE_BYTES = 2 * 1024 ** 3;

/**
 * Identity of one immutable original: owner, mode, object key, media revision
 * and byte size. A revision or size change makes the previous copy unusable.
 */
export interface SourceCacheKey {
  ownerId: string;
  libraryMode: string;
  objectKey: string;
  mediaRevision: number;
  size: number;
}

export interface CachedSource {
  path: string;
  sha256: string;
  size: number;
}

export interface SourceCapture {
  source: AsyncIterable<Uint8Array>;
  /** Persist the fully-read stream only when key and byte size still match. */
  commit(sha256: string): Promise<void>;
  /** Remove the partial copy; a no-op after commit. */
  abort(): Promise<void>;
}

interface CacheEntry extends CachedSource {
  accessedAt: number;
}

export function sourceCacheBytesFromEnvironment(
  raw: string | undefined = process.env.SEKEREAGLE_WORKER_SOURCE_CACHE_BYTES,
): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SOURCE_CACHE_BYTES;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SOURCE_CACHE_BYTES;
}

/** Null disables caching for this source (unknown size or revision). */
export function workerSourceCacheKey(input: {
  ownerId: string;
  libraryMode: string;
  objectKey: string;
  mediaRevision: number;
  size: bigint | number;
}): SourceCacheKey | null {
  const size = typeof input.size === 'bigint' ? Number(input.size) : input.size;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!Number.isSafeInteger(input.mediaRevision)) return null;
  return {
    ownerId: input.ownerId,
    libraryMode: input.libraryMode,
    objectKey: input.objectKey,
    mediaRevision: input.mediaRevision,
    size,
  };
}

function cacheKeyId(key: SourceCacheKey): string {
  return createHash('sha256')
    .update(
      [
        key.ownerId,
        key.libraryMode,
        key.objectKey,
        String(key.mediaRevision),
        String(key.size),
      ].join('\u0000'),
    )
    .digest('hex');
}

/**
 * Bounded, process-private on-disk copy of recent originals. Preview jobs tee
 * the bytes they already download; pyramid jobs read them instead of asking
 * object storage again. Any miss, mismatch or read failure falls back to the
 * original: this cache never decides correctness, only avoids a second transfer.
 */
export class WorkerSourceCache {
  private readonly maxBytes: number;
  private directory?: Promise<string>;
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(options: { directory?: string; maxBytes?: number } = {}) {
    this.maxBytes =
      Number.isSafeInteger(options.maxBytes) && options.maxBytes! >= 0
        ? options.maxBytes!
        : sourceCacheBytesFromEnvironment();
    if (options.directory) {
      this.directory = mkdir(options.directory, { recursive: true, mode: 0o700 }).then(
        () => options.directory!,
      );
    }
  }

  get enabled(): boolean {
    return this.maxBytes > 0;
  }

  get usedBytes(): number {
    return this.totalBytes;
  }

  async lookup(key: SourceCacheKey): Promise<CachedSource | null> {
    if (!this.enabled) return null;
    const id = cacheKeyId(key);
    const entry = this.entries.get(id);
    if (!entry) return null;
    try {
      const details = await stat(entry.path);
      if (!details.isFile() || details.size !== entry.size || entry.size !== key.size) {
        await this.forget(id);
        return null;
      }
    } catch {
      await this.forget(id);
      return null;
    }
    entry.accessedAt = Date.now();
    return { path: entry.path, sha256: entry.sha256, size: entry.size };
  }

  async tee(key: SourceCacheKey, source: AsyncIterable<Uint8Array>): Promise<SourceCapture> {
    const passthrough: SourceCapture = {
      source,
      commit: () => Promise.resolve(),
      abort: () => Promise.resolve(),
    };
    if (!this.enabled) return passthrough;
    try {
      const directory = await this.ensureDirectory();
      const partialPath = join(directory, `partial-${randomUUID()}`);
      const handle = await open(partialPath, 'wx', 0o600);
      let written = 0;
      let writeFailed = false;
      let closed = false;
      let settled = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await handle.close().catch(() => undefined);
      };
      const teed: AsyncIterable<Uint8Array> = (async function* () {
        try {
          for await (const chunk of source) {
            if (!writeFailed) {
              written += chunk.byteLength;
              let offset = 0;
              try {
                while (offset < chunk.byteLength) {
                  const { bytesWritten } = await handle.write(
                    chunk,
                    offset,
                    chunk.byteLength - offset,
                  );
                  offset += bytesWritten;
                }
              } catch {
                // Cache write failures must never fail the media pipeline.
                writeFailed = true;
                await close();
              }
            }
            yield chunk;
          }
        } finally {
          await close();
        }
      })();
      return {
        source: teed,
        commit: async (sha256: string) => {
          if (settled) return;
          settled = true;
          await close();
          if (writeFailed || written !== key.size || !/^[a-f0-9]{64}$/.test(sha256)) {
            await rm(partialPath, { force: true }).catch(() => undefined);
            return;
          }
          const id = cacheKeyId(key);
          const finalPath = join(directory, `${id}-${key.size}-${sha256}.bin`);
          await rm(finalPath, { force: true }).catch(() => undefined);
          try {
            await rename(partialPath, finalPath);
          } catch {
            await rm(partialPath, { force: true }).catch(() => undefined);
            return;
          }
          await this.register(id, { path: finalPath, sha256, size: key.size });
        },
        abort: async () => {
          if (settled) return;
          settled = true;
          await close();
          await rm(partialPath, { force: true }).catch(() => undefined);
        },
      };
    } catch {
      return passthrough;
    }
  }

  async invalidate(cached: CachedSource): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.path === cached.path) {
        await this.forget(id);
        return;
      }
    }
  }

  private async forget(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.totalBytes -= entry.size;
    await rm(entry.path, { force: true }).catch(() => undefined);
  }

  private async register(id: string, entry: CachedSource): Promise<void> {
    const previous = this.entries.get(id);
    if (previous) {
      this.entries.delete(id);
      this.totalBytes -= previous.size;
      if (previous.path !== entry.path)
        await rm(previous.path, { force: true }).catch(() => undefined);
    }
    this.entries.set(id, { ...entry, accessedAt: Date.now() });
    this.totalBytes += entry.size;
    while (this.totalBytes > this.maxBytes) {
      let oldestId: string | undefined;
      let oldestAt = Infinity;
      for (const [candidate, value] of this.entries) {
        if (value.accessedAt < oldestAt) {
          oldestAt = value.accessedAt;
          oldestId = candidate;
        }
      }
      if (oldestId === undefined) return;
      await this.forget(oldestId);
    }
  }

  private ensureDirectory(): Promise<string> {
    this.directory ??= (async () => {
      // A fixed directory lets the next process remove copies orphaned by a
      // crash; the cache is disposable and never owns publication inputs.
      const directory = join(tmpdir(), 'sekereagle-source-cache');
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return directory;
    })();
    return this.directory;
  }
}
