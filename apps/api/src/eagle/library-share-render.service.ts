import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type LibraryMode,
  type LibraryShareRender,
  type LibraryShareRenderStage,
  type LibraryShareRenderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LIBRARY_MODE } from './library-mode';
import {
  SHARE_RENDERER_ID,
  SHARE_RENDER_CHANNEL,
  SHARE_RENDER_HEARTBEAT_ONLINE_MS,
} from './library-share-render-contract';
import { shareImageBudget, shareImageSpec } from './library-share-image';
import { visibleAssetWhere } from './library-values';

export interface ShareRenderResult {
  id: string;
  status: LibraryShareRenderStatus;
  stage: LibraryShareRenderStage;
  elapsedMs: number;
  renditionId?: string;
  contentUrl?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  errorCode?: string;
  rendererOnline?: boolean;
  cached?: boolean;
}

interface ReadyRendition {
  id: string;
  byteSize: bigint;
  width: number | null;
  height: number | null;
}

@Injectable()
export class LibraryShareRenderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}

  async request(
    ownerId: string,
    assetId: string,
    includePrivate = false,
  ): Promise<ShareRenderResult> {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: {
        ...visibleAssetWhere(ownerId, this.libraryMode, includePrivate, 'media'),
        id: assetId,
      },
      select: { id: true, mimeType: true, mediaRevision: true },
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    if (!asset.mimeType.startsWith('image/'))
      throw new BadRequestException('仅图片支持复制分享版。');

    const spec = shareImageSpec(shareImageBudget());
    const cached = await this.findReadyRendition(ownerId, assetId, asset.mediaRevision, spec);
    if (cached) return this.readyResult(assetId, cached, true);

    let job =
      (await this.findJob(ownerId, assetId, asset.mediaRevision, spec)) ??
      (await this.createJob(ownerId, assetId, asset.mediaRevision, spec));

    if (job.status === 'READY') {
      const rendition = job.resultRenditionId
        ? await this.findRenditionById(ownerId, assetId, job.resultRenditionId, job.assetRevision)
        : null;
      if (rendition) return this.readyResult(assetId, rendition, false);
      job = await this.resetJob(job);
    } else if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      job = await this.resetJob(job);
    }

    return this.pendingResult(assetId, job);
  }

  async status(
    ownerId: string,
    assetId: string,
    renderId: string,
    includePrivate = false,
  ): Promise<ShareRenderResult> {
    const asset = await this.requireVisibleAsset(ownerId, assetId, includePrivate);
    const job = await this.prisma.libraryShareRender.findFirst({
      where: { id: renderId, ownerId, libraryMode: this.libraryMode, assetId },
    });
    if (!job) throw new NotFoundException('分享图任务不存在。');
    if (job.assetRevision !== asset.mediaRevision) return this.failedResult(job, 'ASSET_CHANGED');

    if (job.status === 'READY') {
      const rendition = job.resultRenditionId
        ? await this.findRenditionById(ownerId, assetId, job.resultRenditionId, job.assetRevision)
        : null;
      if (rendition) return this.readyResult(assetId, rendition, false);
      return this.failedResult(job, 'ASSET_CHANGED');
    }
    return this.pendingResult(assetId, job, true);
  }

  async cancel(
    ownerId: string,
    assetId: string,
    renderId: string,
    includePrivate = false,
  ): Promise<ShareRenderResult> {
    const asset = await this.requireVisibleAsset(ownerId, assetId, includePrivate);
    const job = await this.prisma.libraryShareRender.findFirst({
      where: { id: renderId, ownerId, libraryMode: this.libraryMode, assetId },
    });
    if (!job) throw new NotFoundException('分享图任务不存在。');
    if (job.assetRevision !== asset.mediaRevision) return this.failedResult(job, 'ASSET_CHANGED');
    if (job.status === 'READY') {
      const rendition = job.resultRenditionId
        ? await this.findRenditionById(ownerId, assetId, job.resultRenditionId, job.assetRevision)
        : null;
      if (rendition) return this.readyResult(assetId, rendition, false);
      return this.failedResult(job, 'ASSET_CHANGED');
    }
    if (job.status === 'CANCELLED') return this.pendingResult(assetId, job, true);
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        ownerId,
        libraryMode: this.libraryMode,
        assetId,
        status: job.status,
        leaseVersion: job.leaseVersion,
      },
      data: {
        status: 'CANCELLED',
        stage: 'CANCELLED',
        cancelledAt: new Date(),
        leaseUntil: null,
        availableAt: new Date(),
        leaseVersion: { increment: 1 },
      },
    });
    const current = await this.prisma.libraryShareRender.findUniqueOrThrow({
      where: { id: job.id },
    });
    return this.pendingResult(assetId, current, true);
  }

  private async requireVisibleAsset(
    ownerId: string,
    assetId: string,
    includePrivate: boolean,
  ): Promise<{ id: string; mediaRevision: number }> {
    const asset = await this.prisma.eagleAsset.findFirst({
      where: {
        ...visibleAssetWhere(ownerId, this.libraryMode, includePrivate, 'media'),
        id: assetId,
      },
      select: { id: true, mediaRevision: true },
    });
    if (!asset) throw new NotFoundException('素材不存在。');
    return asset;
  }

  private findJob(
    ownerId: string,
    assetId: string,
    assetRevision: number,
    spec: string,
  ): Promise<LibraryShareRender | null> {
    return this.prisma.libraryShareRender.findUnique({
      where: {
        ownerId_libraryMode_assetId_assetRevision_spec: {
          ownerId,
          libraryMode: this.libraryMode,
          assetId,
          assetRevision,
          spec,
        },
      },
    });
  }

  private async createJob(
    ownerId: string,
    assetId: string,
    assetRevision: number,
    spec: string,
  ): Promise<LibraryShareRender> {
    try {
      const job = await this.prisma.libraryShareRender.create({
        data: {
          ownerId,
          libraryMode: this.libraryMode,
          assetId,
          assetRevision,
          spec,
        },
      });
      await this.notify(job.id);
      return job;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const existing = await this.findJob(ownerId, assetId, assetRevision, spec);
      if (!existing) throw error;
      return existing;
    }
  }

  private async resetJob(job: LibraryShareRender): Promise<LibraryShareRender> {
    await this.prisma.libraryShareRender.updateMany({
      where: {
        id: job.id,
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        status: job.status,
        leaseVersion: job.leaseVersion,
      },
      data: {
        status: 'PENDING',
        stage: 'QUEUED',
        attempts: 0,
        leaseUntil: null,
        availableAt: new Date(),
        // Restart the elapsed-time clock on an explicit retry.
        startedAt: new Date(),
        completedAt: null,
        cancelledAt: null,
        resultRenditionId: null,
        errorCode: null,
        leaseVersion: { increment: 1 },
      },
    });
    const current = await this.prisma.libraryShareRender.findUniqueOrThrow({
      where: { id: job.id },
    });
    if (current.status === 'PENDING') await this.notify(current.id);
    return current;
  }

  private findReadyRendition(
    ownerId: string,
    assetId: string,
    assetRevision: number,
    spec: string,
  ): Promise<ReadyRendition | null> {
    return this.prisma.eagleAssetRendition.findFirst({
      where: {
        ownerId,
        libraryMode: this.libraryMode,
        assetId,
        kind: 'SHARE_JPEG',
        revision: assetRevision,
        variant: spec,
        status: 'READY',
      },
      select: { id: true, byteSize: true, width: true, height: true },
    });
  }

  private findRenditionById(
    ownerId: string,
    assetId: string,
    renditionId: string,
    assetRevision: number,
  ): Promise<ReadyRendition | null> {
    return this.prisma.eagleAssetRendition.findFirst({
      where: {
        id: renditionId,
        ownerId,
        libraryMode: this.libraryMode,
        assetId,
        kind: 'SHARE_JPEG',
        status: 'READY',
        revision: assetRevision,
      },
      select: { id: true, byteSize: true, width: true, height: true },
    });
  }

  private readyResult(
    assetId: string,
    rendition: ReadyRendition,
    cached: boolean,
  ): ShareRenderResult {
    return {
      id: rendition.id,
      status: 'READY',
      stage: 'READY',
      elapsedMs: 0,
      renditionId: rendition.id,
      contentUrl: this.contentUrl(assetId, rendition.id),
      width: rendition.width ?? undefined,
      height: rendition.height ?? undefined,
      byteSize: Number(rendition.byteSize),
      cached,
    };
  }

  private pendingResult(
    assetId: string,
    job: LibraryShareRender,
    includeRendererState = false,
  ): Promise<ShareRenderResult> | ShareRenderResult {
    const base: ShareRenderResult = {
      id: job.id,
      status: job.status,
      stage: job.stage,
      elapsedMs: Math.max(0, Date.now() - (job.startedAt ?? job.createdAt).getTime()),
      errorCode: job.errorCode ?? undefined,
    };
    if (job.status === 'READY' && job.resultRenditionId) {
      base.renditionId = job.resultRenditionId;
      base.contentUrl = this.contentUrl(assetId, job.resultRenditionId);
    }
    if (!includeRendererState || job.status !== 'PENDING') return base;
    return this.rendererOnline().then((online) => ({ ...base, rendererOnline: online }));
  }

  private failedResult(job: LibraryShareRender, errorCode: string): ShareRenderResult {
    return {
      id: job.id,
      status: 'FAILED',
      stage: 'FAILED',
      elapsedMs: Math.max(0, Date.now() - (job.startedAt ?? job.createdAt).getTime()),
      errorCode,
    };
  }

  private contentUrl(assetId: string, renditionId: string): string {
    const prefix = this.libraryMode === 'PHOTO' ? 'photos' : 'eagle';
    return `/api/${prefix}/assets/${assetId}/renditions/${renditionId}/content`;
  }

  private async rendererOnline(): Promise<boolean> {
    const state = await this.prisma.libraryShareRendererState.findUnique({
      where: { id: SHARE_RENDERER_ID },
      select: { heartbeatAt: true },
    });
    return Boolean(
      state && Date.now() - state.heartbeatAt.getTime() <= SHARE_RENDER_HEARTBEAT_ONLINE_MS,
    );
  }

  private async notify(id: string): Promise<void> {
    await this.prisma.$executeRaw`SELECT pg_notify(${SHARE_RENDER_CHANNEL}, ${id})`;
  }
}
