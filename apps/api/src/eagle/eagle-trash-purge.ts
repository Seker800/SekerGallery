import { Prisma, type LibraryMode } from '@prisma/client';

export interface PurgeBatchInput {
  ownerId: string;
  libraryMode: LibraryMode;
  includePrivate: boolean;
  purgeAfter: Date;
  limit: number;
  /** Explicit selection; omitted for the next bounded clear-trash batch. */
  assetIds?: readonly string[];
  cutoff?: Date;
}

/**
 * One statement owns the lifecycle: lock the exact rows, mark them, and enqueue
 * purge jobs from the same target set. A concurrent restore either commits first
 * and is excluded, or waits behind the row lock; it can never be enqueued.
 */
export function purgeBatchSql(input: PurgeBatchInput): Prisma.Sql {
  const targetScope = input.assetIds
    ? Prisma.sql`AND asset.id = ANY(${input.assetIds}::text[])`
    : Prisma.sql`AND asset."purgeAfter" IS NULL`;
  const cutoff = input.cutoff ? Prisma.sql`AND asset."deletedAt" <= ${input.cutoff}` : Prisma.empty;
  return Prisma.sql`
    WITH targets AS (
      SELECT asset.id, asset."mediaRevision"
      FROM "EagleAsset" asset
      WHERE asset."ownerId"=${input.ownerId}
        AND asset."libraryMode"=${input.libraryMode}::"LibraryMode"
        AND asset."deletedAt" IS NOT NULL
        ${targetScope}
        ${cutoff}
        AND (${input.includePrivate} OR NOT asset."isPrivate")
      ORDER BY asset.id
      LIMIT ${input.limit}
      FOR UPDATE
    ), marked AS (
      UPDATE "EagleAsset" AS asset
      SET "purgeAfter"=${input.purgeAfter}, "rowVersion"="rowVersion"+1, "updatedAt"=CURRENT_TIMESTAMP
      FROM targets
      WHERE asset.id=targets.id AND asset."purgeAfter" IS NULL
      RETURNING asset.id, asset."mediaRevision"
    ), scheduled AS (
      INSERT INTO "EagleMediaJob" AS job
        (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","processorVersion",
         status,attempts,"recoveryCount","leaseVersion","availableAt","updatedAt")
      SELECT gen_random_uuid()::text,${input.ownerId},${input.libraryMode}::"LibraryMode",target.id,
        'PURGE_ASSET'::"EagleMediaJobKind",'MAINTENANCE'::"EagleProcessingLane","mediaRevision",'v1',
        'PENDING'::"EagleMediaJobStatus",0,0,1,${input.purgeAfter},CURRENT_TIMESTAMP
      FROM targets target
      ON CONFLICT ("assetId",kind,"assetRevision","processorVersion") DO UPDATE
      SET status='PENDING',attempts=0,"recoveryCount"=0,"leaseVersion"=job."leaseVersion"+1,
        "availableAt"=EXCLUDED."availableAt","lockedAt"=NULL,"startedAt"=NULL,
        "completedAt"=NULL,"lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP
      WHERE job."ownerId"=EXCLUDED."ownerId" AND job."libraryMode"=EXCLUDED."libraryMode"
        AND job.status IN ('PENDING','FAILED','COMPLETED')
      RETURNING job.id
    ), requeued_legacy AS (
      -- Previous clear-trash commands also requeued older media/processor
      -- identities. Keep that contract without updating the current upsert
      -- identity twice in the same statement or taking a PROCESSING lease.
      UPDATE "EagleMediaJob" AS job
      SET status='PENDING',attempts=0,"recoveryCount"=0,"leaseVersion"=job."leaseVersion"+1,
        "availableAt"=${input.purgeAfter},"lockedAt"=NULL,"startedAt"=NULL,
        "completedAt"=NULL,"lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP
      FROM targets target
      WHERE job."assetId"=target.id AND job."ownerId"=${input.ownerId}
        AND job."libraryMode"=${input.libraryMode}::"LibraryMode" AND job.kind='PURGE_ASSET'
        AND job.status IN ('PENDING','FAILED','COMPLETED')
        AND (job."assetRevision"<>target."mediaRevision" OR job."processorVersion"<>'v1')
      RETURNING job.id
    ) SELECT count(*)::int AS "affectedAssetCount" FROM targets
  `;
}
