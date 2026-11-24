import { createHash, randomUUID } from 'node:crypto';
import type { LibraryShareRender } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { assertOwnedObjectKey } from '../storage/object-key';
import type { ObjectStorageService } from '../storage/object-storage.service';
import {
  SHARE_RENDERER_ID,
  SHARE_RENDER_LEASE_MS,
  SHARE_RENDER_MAX_ATTEMPTS,
  SHARE_RENDER_POLL_MS,
  SHARE_RENDER_RETRY_DELAY_MS,
  shareRenderReadyRetentionMs,
} from './library-share-render-contract';
import {
  renderShareImage,
  shareImageBudgetFromSpec,
  type ShareRenderStage,
} from './library-share-image';

class ShareRenderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class ShareRenderCancelledError extends Error {}

const RETRYABLE_ERROR_CODES = new Set([
  'RENDER_FAILED',
  'STORAGE_READ_FAILED',
  'STORAGE_WRITE_FAILED',
  'INTERNAL',
]);

/** One interactive share image at a time; the API never decodes the original. */
export class LibraryShareRenderWorker {
  private stopping = false;
  private loopPromise: Promise<void> | undefined;
  private activeController: AbortController | undefined;
  private activeJobCount = 0;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private checkingHeartbeat = false;
  private cleaning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  start(): void {
    if (this.loopPromise) return;
    this.stopping = false;
    void this.heartbeat();
    void this.cleanup();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 15_000);
    this.cleanupTimer = setInterval(() => void this.cleanup(), 10 * 60_000);
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.activeController?.abort();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.heartbeatTimer = undefined;
    this.cleanupTimer = undefined;
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        const job = await this.claim();
        if (!job) {
          await sleep(SHARE_RENDER_POLL_MS);
          continue;
        }
        this.activeJobCount = 1;
        await this.runJob(job);
      } catch (error) {
        this.report(error);
        await sleep(1_000);
      } finally {
        this.activeJobCount = 0;
      }
    }
  }

  private async claim(): Promise<LibraryShareRender | null> {
    const rows = await this.prisma.$queryRaw<LibraryShareRender[]>`
      WITH candidate AS (
        SELECT id FROM "LibraryShareRender"
        WHERE "cancelledAt" IS NULL
          AND (
            ("status" = 'PENDING' AND "availableAt" <= now())
            OR (
              "status" = 'PROCESSING'
              AND "leaseUntil" IS NOT NULL
              AND "leaseUntil" < now()
            )
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "LibraryShareRender" job
      SET "status" = 'PROCESSING'::"LibraryShareRenderStatus",
          "stage" = 'QUEUED'::"LibraryShareRenderStage",
          "startedAt" = COALESCE(job."startedAt", now()),
          "leaseUntil" = now() + (${SHARE_RENDER_LEASE_MS} * interval '1 millisecond'),
          "leaseVersion" = job."leaseVersion" + 1,
          "attempts" = job."attempts" + 1,
          "updatedAt" = now()
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.*
    `;
    return rows[0] ?? null;
  }

  private async runJob(job: LibraryShareRender): Promise<void> {
    if (job.attempts > SHARE_RENDER_MAX_ATTEMPTS) {
      await this.fail(job, 'RETRY_EXHAUSTED');
      return;
    }

    const cached = await this.findReadyRendition(job);
    if (cached) {
      await this.markReady(job, cached.id);
      return;
    }

    const asset = await this.prisma.eagleAsset.findFirst({
      where: {
        id: job.assetId,
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        mediaRevision: job.assetRevision,
        purgeAfter: null,
      },
      select: { originalObjectKey: true, mimeType: true },
    });
    if (!asset) {
      await this.fail(job, 'ASSET_CHANGED');
      return;
    }
    if (!asset.mimeType.startsWith('image/')) {
      await this.fail(job, 'NOT_IMAGE');
      return;
    }
    try {
      assertOwnedObjectKey(job.ownerId, asset.originalObjectKey);
    } catch {
      await this.fail(job, 'SOURCE_MISSING');
      return;
    }

    let budget;
    try {
      budget = shareImageBudgetFromSpec(job.spec);
    } catch {
      await this.fail(job, 'INVALID_SPEC');
      return;
    }

    const controller = new AbortController();
    this.activeController = controller;
    let watcherClosed = false;
    let watcherTimer: NodeJS.Timeout | undefined;
    const watch = async () => {
      if (watcherClosed) return;
      try {
        const current = await this.prisma.libraryShareRender.findUnique({
          where: { id: job.id },
          select: { status: true, cancelledAt: true, leaseVersion: true },
        });
        if (
          !current ||
          current.status === 'CANCELLED' ||
          current.cancelledAt ||
          current.leaseVersion !== job.leaseVersion
        ) {
          controller.abort();
          return;
        }
        await this.prisma.libraryShareRender.updateMany({
          where: {
            id: job.id,
            leaseVersion: job.leaseVersion,
            status: 'PROCESSING',
            cancelledAt: null,
          },
          data: { leaseUntil: new Date(Date.now() + SHARE_RENDER_LEASE_MS) },
        });
      } catch (error) {
        this.report(error);
      } finally {
        if (!watcherClosed) watcherTimer = setTimeout(() => void watch(), 1_000);
      }
    };
    watcherTimer = setTimeout(() => void watch(), 1_000);

    try {
      const rendered = await renderShareImage(
        {
          mimeType: asset.mimeType,
          openBody: async () => {
            try {
              const object = await this.storage.getObject(asset.originalObjectKey, {
                abortSignal: controller.signal,
              });
              if (!object.Body) throw new ShareRenderError('STORAGE_READ_FAILED');
              return object.Body as unknown as AsyncIterable<Uint8Array>;
            } catch (error) {
              if (error instanceof ShareRenderError) throw error;
              throw new ShareRenderError('STORAGE_READ_FAILED');
            }
          },
        },
        budget,
        controller.signal,
        async (stage: ShareRenderStage) => {
          const updated = await this.prisma.libraryShareRender.updateMany({
            where: {
              id: job.id,
              leaseVersion: job.leaseVersion,
              status: 'PROCESSING',
              cancelledAt: null,
            },
            data: { stage },
          });
          if (!updated.count) {
            controller.abort();
            throw new ShareRenderCancelledError();
          }
        },
      );
      if (controller.signal.aborted) throw new ShareRenderCancelledError();
      await this.publish(job, rendered);
    } catch (error) {
      if (this.stopping) await this.releaseOnShutdown(job);
      else if (error instanceof ShareRenderCancelledError || controller.signal.aborted)
        await this.markCancelled(job);
      else await this.fail(job, this.errorCode(error));
    } finally {
      watcherClosed = true;
      if (watcherTimer) clearTimeout(watcherTimer);
      this.activeController = undefined;
    }
  }

  private objectKey(job: LibraryShareRender): string {
    const hash = createHash('sha256').update(job.spec).digest('hex').slice(0, 16);
    // Unique per attempt: an older failed attempt's outbox must never delete a later successful object.
    return `users/${job.ownerId}/assets/${job.assetId}/renditions/${job.assetRevision}/share-${hash}-${randomUUID()}.jpg`;
  }

  private async publish(
    job: LibraryShareRender,
    rendered: { buffer: Buffer; width: number; height: number; byteSize: number },
  ): Promise<void> {
    const key = this.objectKey(job);
    assertOwnedObjectKey(job.ownerId, key);
    const outbox = await this.prisma.eagleObjectDeletion.create({
      data: {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        objectKeys: [key],
        prefixes: [],
        // Do not let the deletion runner race the upload/publication window.
        availableAt: new Date(Date.now() + SHARE_RENDER_LEASE_MS),
      },
    });
    try {
      try {
        await this.storage.putObject(key, rendered.buffer, 'image/jpeg');
      } catch {
        throw new ShareRenderError('STORAGE_WRITE_FAILED');
      }

      await this.prisma
        .$transaction(async (tx) => {
          const existing = await tx.eagleAssetRendition.findFirst({
            where: {
              ownerId: job.ownerId,
              libraryMode: job.libraryMode,
              assetId: job.assetId,
              kind: 'SHARE_JPEG',
              revision: job.assetRevision,
              variant: job.spec,
            },
            select: { id: true, storageKey: true },
          });
          if (existing && existing.storageKey !== key) {
            await tx.eagleObjectDeletion.create({
              data: {
                ownerId: job.ownerId,
                libraryMode: job.libraryMode,
                objectKeys: [existing.storageKey],
                prefixes: [],
              },
            });
          }
          const rendition = await tx.eagleAssetRendition.upsert({
            where: {
              assetId_kind_revision_variant: {
                assetId: job.assetId,
                kind: 'SHARE_JPEG',
                revision: job.assetRevision,
                variant: job.spec,
              },
            },
            create: {
              ownerId: job.ownerId,
              libraryMode: job.libraryMode,
              assetId: job.assetId,
              kind: 'SHARE_JPEG',
              revision: job.assetRevision,
              variant: job.spec,
              storageKey: key,
              mimeType: 'image/jpeg',
              byteSize: BigInt(rendered.byteSize),
              width: rendered.width,
              height: rendered.height,
              status: 'READY',
            },
            update: {
              storageKey: key,
              mimeType: 'image/jpeg',
              byteSize: BigInt(rendered.byteSize),
              width: rendered.width,
              height: rendered.height,
              status: 'READY',
            },
            select: { id: true },
          });
          const finished = await tx.libraryShareRender.updateMany({
            where: {
              id: job.id,
              leaseVersion: job.leaseVersion,
              status: 'PROCESSING',
              cancelledAt: null,
            },
            data: {
              status: 'READY',
              stage: 'READY',
              completedAt: new Date(),
              leaseUntil: null,
              resultRenditionId: rendition.id,
              errorCode: null,
            },
          });
          if (!finished.count) throw new ShareRenderCancelledError();
          const retained = await tx.eagleObjectDeletion.deleteMany({
            where: { id: outbox.id, status: 'PENDING' },
          });
          if (!retained.count) throw new ShareRenderError('INTERNAL');
        })
        .catch((error) => {
          if (error instanceof ShareRenderCancelledError) throw error;
          throw new ShareRenderError('INTERNAL');
        });
    } catch (error) {
      // The object is now an orphan: make it immediately eligible for deletion.
      await this.prisma.eagleObjectDeletion
        .updateMany({
          where: { id: outbox.id, status: 'PENDING' },
          data: { availableAt: new Date() },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async findReadyRendition(job: LibraryShareRender): Promise<{ id: string } | null> {
    return this.prisma.eagleAssetRendition.findFirst({
      where: {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        assetId: job.assetId,
        kind: 'SHARE_JPEG',
        revision: job.assetRevision,
        variant: job.spec,
        status: 'READY',
      },
      select: { id: true },
    });
  }

  private async markReady(job: LibraryShareRender, renditionId: string): Promise<void> {
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        leaseVersion: job.leaseVersion,
        status: 'PROCESSING',
        cancelledAt: null,
      },
      data: {
        status: 'READY',
        stage: 'READY',
        completedAt: new Date(),
        leaseUntil: null,
        resultRenditionId: renditionId,
        errorCode: null,
      },
    });
  }

  private async fail(job: LibraryShareRender, errorCode: string): Promise<void> {
    const current = await this.prisma.libraryShareRender.findUnique({
      where: { id: job.id },
      select: { attempts: true, status: true, cancelledAt: true, leaseVersion: true },
    });
    if (!current || current.leaseVersion !== job.leaseVersion) return;
    if (current.cancelledAt || current.status === 'CANCELLED') {
      await this.markCancelled(job);
      return;
    }
    const retry =
      RETRYABLE_ERROR_CODES.has(errorCode) && current.attempts < SHARE_RENDER_MAX_ATTEMPTS;
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        leaseVersion: job.leaseVersion,
        status: 'PROCESSING',
      },
      data: retry
        ? {
            status: 'PENDING',
            stage: 'QUEUED',
            availableAt: new Date(Date.now() + SHARE_RENDER_RETRY_DELAY_MS),
            leaseUntil: null,
            errorCode,
          }
        : {
            status: 'FAILED',
            stage: 'FAILED',
            completedAt: new Date(),
            leaseUntil: null,
            errorCode,
          },
    });
  }

  private async markCancelled(job: LibraryShareRender): Promise<void> {
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        leaseVersion: job.leaseVersion,
        status: 'PROCESSING',
      },
      data: {
        status: 'CANCELLED',
        stage: 'CANCELLED',
        cancelledAt: new Date(),
        completedAt: new Date(),
        leaseUntil: null,
        errorCode: 'CANCELLED',
      },
    });
  }

  private async releaseOnShutdown(job: LibraryShareRender): Promise<void> {
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        leaseVersion: job.leaseVersion,
        status: 'PROCESSING',
        cancelledAt: null,
      },
      data: {
        status: 'PENDING',
        stage: 'QUEUED',
        availableAt: new Date(),
        leaseUntil: null,
        attempts: { decrement: 1 },
      },
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof ShareRenderError) return error.code;
    return 'RENDER_FAILED';
  }

  private async heartbeat(): Promise<void> {
    if (this.checkingHeartbeat || this.stopping) return;
    this.checkingHeartbeat = true;
    try {
      await this.prisma.libraryShareRendererState.upsert({
        where: { id: SHARE_RENDERER_ID },
        create: {
          id: SHARE_RENDERER_ID,
          heartbeatAt: new Date(),
          activeJobCount: this.activeJobCount,
          version: 'share-v1',
        },
        update: {
          heartbeatAt: new Date(),
          activeJobCount: this.activeJobCount,
          version: 'share-v1',
        },
      });
    } catch (error) {
      this.report(error);
    } finally {
      this.checkingHeartbeat = false;
    }
  }

  private async cleanup(): Promise<void> {
    if (this.cleaning || this.stopping) return;
    this.cleaning = true;
    try {
      const cutoff = new Date(Date.now() - shareRenderReadyRetentionMs());
      const rows = await this.prisma.libraryShareRender.findMany({
        where: {
          status: { in: ['READY', 'FAILED', 'CANCELLED'] },
          completedAt: { lt: cutoff },
        },
        select: { id: true },
        orderBy: { completedAt: 'asc' },
        take: 100,
      });
      if (rows.length)
        await this.prisma.libraryShareRender.deleteMany({
          where: {
            id: { in: rows.map((row) => row.id) },
            status: { in: ['READY', 'FAILED', 'CANCELLED'] },
            completedAt: { lt: cutoff },
          },
        });
    } catch (error) {
      this.report(error);
    } finally {
      this.cleaning = false;
    }
  }

  private report(error: unknown): void {
    console.error('Share renderer loop error:', error instanceof Error ? error.message : 'unknown');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
