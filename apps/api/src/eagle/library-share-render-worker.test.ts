import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { LibraryShareRenderWorker } from './library-share-render-worker';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('stop waits for in-flight startup heartbeat and cleanup before resolving', async () => {
  const heartbeat = gate();
  const cleanup = gate();
  const prisma = {
    libraryShareRendererState: {
      upsert: async () => {
        await heartbeat.promise;
        return {};
      },
    },
    libraryShareRender: {
      findMany: async () => {
        await cleanup.promise;
        return [];
      },
      deleteMany: async () => ({ count: 0 }),
    },
    $queryRaw: async () => [],
  } as unknown as PrismaService;
  const worker = new LibraryShareRenderWorker(prisma, {} as ObjectStorageService);
  worker.start();
  const stopped = worker.stop();
  let settled = false;
  void stopped.then(() => {
    settled = true;
  });
  await delay(700);
  assert.equal(settled, false, 'stop must wait for in-flight heartbeat and cleanup');
  heartbeat.release();
  cleanup.release();
  await stopped;
  assert.equal(settled, true);
});
