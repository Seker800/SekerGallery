import { memo } from 'react';
import { EagleUploadQueue } from './EagleUploadQueue';
import { useEagleUploadSnapshot } from './useEagleUploadController';
import type { LibraryUploadQueue } from '../../lib/library-upload-queue';

/** Owns the progress subscription so the library page does not re-render per event. */
export const EagleUploadQueuePanel = memo(function EagleUploadQueuePanel({
  queue,
  scope,
}: {
  queue: LibraryUploadQueue;
  scope: string;
}) {
  const { uploads, summary } = useEagleUploadSnapshot(queue, scope);
  return (
    <EagleUploadQueue
      items={uploads}
      summary={summary}
      onPause={queue.pauseAll}
      onResume={queue.resumeAll}
      onRetryAll={() => queue.retryAllFailed(scope)}
      onRetry={(id) => queue.enqueue([id])}
      onDismiss={() => queue.dismiss(scope)}
    />
  );
});
