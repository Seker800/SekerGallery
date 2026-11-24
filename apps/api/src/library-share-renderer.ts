import 'reflect-metadata';
import { rm, writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { PrismaService } from './prisma/prisma.service';
import { ObjectStorageService } from './storage/object-storage.service';
import { objectStorageRuntimeOptions } from './config/runtime-config';
import { LibraryShareRenderWorker } from './eagle/library-share-render-worker';

const REQUIRED_STORAGE_KEYS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
] as const;

/** Same API image, separate process: the HTTP API never decodes a share-image original. */
async function main(): Promise<void> {
  const env = process.env;
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL ?? '',
    s3Endpoint: env.S3_ENDPOINT ?? '',
    s3Bucket: env.S3_BUCKET ?? '',
  });
  const storageConfig: Record<string, unknown> = { ...objectStorageRuntimeOptions(env) };
  for (const key of REQUIRED_STORAGE_KEYS) {
    if (!env[key]) throw new Error(`Missing share renderer setting ${key}`);
    storageConfig[key] = env[key];
  }

  const prisma = new PrismaService();
  const storage = new ObjectStorageService(new ConfigService(storageConfig));
  const worker = new LibraryShareRenderWorker(prisma, storage);
  const readyFile = env.EAGLE_SHARE_RENDERER_READY_FILE ?? '/tmp/sekereagle-share-renderer-ready';
  let closing: Promise<void> | undefined;
  const shutdown = () =>
    (closing ??= (async () => {
      await rm(readyFile, { force: true });
      await worker.stop();
      storage.onModuleDestroy();
      await prisma.onModuleDestroy();
    })());

  try {
    await rm(readyFile, { force: true });
    await prisma.onModuleInit();
    await storage.assertReady();
    worker.start();
    await writeFile(readyFile, String(process.pid), { mode: 0o600 });
  } catch (error) {
    await shutdown();
    throw error;
  }

  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  console.info('Share renderer ready; only on-demand share images are rendered.');
}

if (require.main === module)
  void main().catch(() => {
    console.error('Share renderer failed to start.');
    process.exitCode = 1;
  });
