BEGIN;
-- The review candidate query joins current faces to other faces on the same
-- asset. The existing review index is person-first; this asset-first covering
-- index keeps that self-join index-only without touching the business payload.
CREATE INDEX "EaglePhotoFace_review_asset_covering_idx" ON "EaglePhotoFace"
  ("ownerId","libraryMode","assetId")
  INCLUDE ("assetRevision","personId") WHERE "isCurrent";
COMMIT;
