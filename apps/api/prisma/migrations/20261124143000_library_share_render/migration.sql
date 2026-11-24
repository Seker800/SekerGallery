-- Add the permanent share rendition kind. The resulting file is a normal asset
-- rendition: it follows media revisions and is removed with the asset.
ALTER TYPE "EagleRenditionKind" ADD VALUE 'SHARE_JPEG';

CREATE TYPE "LibraryShareRenderStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED');
CREATE TYPE "LibraryShareRenderStage" AS ENUM ('QUEUED', 'READING', 'DECODING', 'ENCODING', 'READY', 'FAILED', 'CANCELLED');

-- Transient progress/lease queue. The durable result lives in EagleAssetRendition.
CREATE TABLE "LibraryShareRender" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL',
    "assetId" TEXT NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "spec" TEXT NOT NULL,
    "status" "LibraryShareRenderStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "LibraryShareRenderStage" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseVersion" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "resultRenditionId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryShareRender_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryShareRender_ownerId_libraryMode_assetId_assetRevision_spec_key" ON "LibraryShareRender"("ownerId", "libraryMode", "assetId", "assetRevision", "spec");
CREATE INDEX "LibraryShareRender_status_availableAt_idx" ON "LibraryShareRender"("status", "availableAt");
CREATE INDEX "LibraryShareRender_status_leaseUntil_idx" ON "LibraryShareRender"("status", "leaseUntil");
CREATE INDEX "LibraryShareRender_ownerId_libraryMode_assetId_idx" ON "LibraryShareRender"("ownerId", "libraryMode", "assetId");
CREATE INDEX "LibraryShareRender_ownerId_libraryMode_createdAt_idx" ON "LibraryShareRender"("ownerId", "libraryMode", "createdAt");

ALTER TABLE "LibraryShareRender" ADD CONSTRAINT "LibraryShareRender_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryShareRender" ADD CONSTRAINT "LibraryShareRender_resultRenditionId_fkey" FOREIGN KEY ("resultRenditionId") REFERENCES "EagleAssetRendition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One row per renderer process; separate from the media-worker heartbeat so the
-- task center never mistakes a renderer for a library-processing worker.
CREATE TABLE "LibraryShareRendererState" (
    "id" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryShareRendererState_pkey" PRIMARY KEY ("id")
);
