-- Persist the negotiated multipart part size so resume paths cannot recompute a
-- different boundary (the Eagle importer previously assumed 5 MiB for every session).
ALTER TABLE "UploadSession" ADD COLUMN "partSize" INTEGER;
