-- Sessions remember the private-visibility grant used at initiation so
-- authoritative dedupe and the preflight make the same scoped decision.
ALTER TABLE "EagleUploadSessionState"
  ADD COLUMN "includePrivate" BOOLEAN NOT NULL DEFAULT false;
