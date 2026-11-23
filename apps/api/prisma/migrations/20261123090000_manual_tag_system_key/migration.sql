ALTER TABLE "EagleManualTag" ADD COLUMN "systemKey" TEXT;

UPDATE "EagleManualTag"
SET "systemKey" = 'FAVORITE'
WHERE "normalizedName" = '收藏';

UPDATE "EagleManualTag"
SET "systemKey" = 'EDIT_COPY'
WHERE "normalizedName" = '已编辑';

CREATE UNIQUE INDEX "EagleManualTag_ownerId_libraryMode_systemKey_key"
ON "EagleManualTag"("ownerId", "libraryMode", "systemKey");
