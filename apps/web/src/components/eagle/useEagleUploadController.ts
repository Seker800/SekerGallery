import { useLibraryWorkspace } from '../../lib/library-workspace';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { UploadDedupeChecker, type UploadDedupeResult } from '../../lib/upload-dedupe';
import type { EagleUploadItem, LibraryUploadQueue } from '../../lib/library-upload-queue';
export type { EagleUploadItem } from '../../lib/library-upload-queue';

export interface EagleUploadSummary {
  total: number;
  uploaded: number;
  completed: number;
  duplicate: number;
  failed: number;
  waiting: number;
  percent: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  paused: boolean;
}

function transferredBytes(items: readonly EagleUploadItem[]) {
  let bytes = 0;
  for (const item of items) {
    if (item.state === 'completed' || item.state === 'duplicate' || item.state === 'uploaded')
      bytes += item.size;
    else if (item.state === 'uploading') bytes += (item.size * item.percent) / 100;
  }
  return bytes;
}

/** Queue, importer and actions without subscribing the caller to progress events. */
export function useEagleUploadController(assetsQueryKey: QueryKey) {
  const {
    api: { uploadEagleAsset, getEagleUploadStatuses, checkEagleUploadContentBatch },
    ownerId,
    libraryMode,
  } = useLibraryWorkspace();
  const client = useQueryClient();
  const cache = getEagleWorkspaceCache(client, ownerId, libraryMode);
  useEffect(() => cache.retain(false), [cache]);
  const queue = cache.uploads;
  const dedupe = useMemo(
    () => new UploadDedupeChecker((items, signal) => checkEagleUploadContentBatch(items, signal)),
    [checkEagleUploadContentBatch],
  );
  const prepared = useMemo(() => {
    const pending = new WeakMap<File, { promise: Promise<UploadDedupeResult>; failed: boolean }>();
    return (file: File) => {
      const cached = pending.get(file);
      if (cached && !cached.failed) return cached.promise;
      const entry: { promise: Promise<UploadDedupeResult>; failed: boolean } = {
        promise: dedupe.check(file, queue.signal),
        failed: false,
      };
      // Started ahead of the upload slots, so a cleared queue must not surface it,
      // and a failed hash must not be reused by a later retry of the same File.
      void entry.promise.catch(() => {
        entry.failed = true;
      });
      pending.set(file, entry);
      return entry.promise;
    };
  }, [dedupe, queue]);
  const scope = hashKey(assetsQueryKey);
  return {
    queue,
    scope,
    importFiles: (files: File[]) => {
      // Hash ahead of the transfer workers, so an upload slot never sits idle
      // while the browser computes a whole-file digest for the file it just took.
      for (const file of files) void prepared(file);
      return queue.add(
        files,
        assetsQueryKey,
        async (file, progress, signal) => {
          progress({ percent: 0, phase: 'checking' });
          signal.throwIfAborted();
          const { sha256, exists, privateMatch } = await prepared(file);
          signal.throwIfAborted();
          if (exists) return { duplicate: true, privateMatch };
          const result = await uploadEagleAsset(file, progress, {
            signal,
            waitForFinalization: false,
            ...(sha256 ? { contentSha256: sha256 } : {}),
          });
          if (result.duplicate) return { duplicate: true };
          return result.assetId ? undefined : { sessionId: result.uploadSessionId };
        },
        (sessionIds, signal) => getEagleUploadStatuses(sessionIds, signal),
      );
    },
    pauseUploads: queue.pauseAll,
    resumeUploads: queue.resumeAll,
    retryAllFailed: () => queue.retryAllFailed(scope),
    dismissUploads: () => queue.dismiss(scope),
    retryUpload: (id: number) => queue.enqueue([id]),
  };
}

/** Subscribes only the upload panel to queue progress. */
export function useEagleUploadSnapshot(queue: LibraryUploadQueue, scope: string) {
  // Subscribe to the scalar version; item objects update in place.
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const uploads = queue.items.filter((item) => item.scope === scope);
  const itemsRef = useRef(uploads);
  itemsRef.current = uploads;
  const [speed, setSpeed] = useState({ bytes: 0, at: 0, speed: 0 });
  const counts = useMemo(() => {
    let completed = 0,
      duplicate = 0,
      failed = 0,
      waiting = 0,
      uploaded = 0,
      totalBytes = 0;
    for (const item of uploads) {
      totalBytes += item.size;
      switch (item.state) {
        case 'completed':
          completed += 1;
          break;
        case 'duplicate':
          duplicate += 1;
          break;
        case 'failed':
          failed += 1;
          break;
        case 'queued':
        case 'checking':
        case 'uploading':
        case 'uploaded':
          waiting += 1;
          break;
      }
      if (item.state === 'uploaded') uploaded += 1;
    }
    return { completed, duplicate, failed, waiting, uploaded, totalBytes };
  }, [uploads]);
  const doneBytes = transferredBytes(uploads);
  const pending = counts.waiting > 0;
  useEffect(() => {
    if (!pending) {
      setSpeed({ bytes: 0, at: 0, speed: 0 });
      return;
    }
    setSpeed({ bytes: transferredBytes(itemsRef.current), at: performance.now(), speed: 0 });
    const timer = setInterval(() => {
      const bytes = transferredBytes(itemsRef.current);
      setSpeed((previous) => {
        const now = performance.now();
        const instant = previous.at ? (bytes - previous.bytes) / ((now - previous.at) / 1000) : 0;
        const smoothed = previous.speed ? previous.speed * 0.65 + instant * 0.35 : instant;
        return { bytes, at: now, speed: Math.max(0, smoothed) };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const remainingBytes = Math.max(0, counts.totalBytes - doneBytes);
  const summary: EagleUploadSummary = {
    total: uploads.length,
    uploaded: counts.completed + counts.uploaded,
    completed: counts.completed,
    duplicate: counts.duplicate,
    failed: counts.failed,
    waiting: counts.waiting,
    percent: counts.totalBytes
      ? Math.min(100, Math.round((doneBytes / counts.totalBytes) * 100))
      : 0,
    bytesPerSecond: pending ? speed.speed : 0,
    remainingSeconds: pending && speed.speed > 0 ? Math.ceil(remainingBytes / speed.speed) : null,
    paused: queue.paused,
  };
  return { uploads, summary };
}
