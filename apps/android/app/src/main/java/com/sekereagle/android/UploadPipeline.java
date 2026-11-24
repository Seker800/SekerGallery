package com.sekereagle.android;

import android.os.SystemClock;
import com.sekereagle.android.core.BackupEngine;
import com.sekereagle.android.core.ContentCheckBatcher;
import com.sekereagle.android.core.UploadBudget;
import com.sekereagle.android.core.UploadRetryPolicy;

/**
 * The single per-file upload algorithm. Manual transfers and automatic backup only provide the
 * file source, journal and progress sinks; hashing, dedupe, parts and completion stay here.
 */
final class UploadPipeline {
  interface Bytes {
    void on(long count);
  }

  interface Stage {
    void on(String text);
  }

  private UploadPipeline() {}

  static BackupEngine.Result process(
      MediaCatalog catalog,
      UploadApi api,
      BackupEngine.Store journal,
      UploadBudget budget,
      ContentCheckBatcher batcher,
      BackupEngine.ContentLock lock,
      String scope,
      String mode,
      MediaCatalog.Item item,
      BackupEngine.Guard guard,
      String knownHash,
      Bytes hashProgress,
      Bytes uploadProgress,
      Stage stage)
      throws Exception {
    catalog.checkSize(item);
    BackupEngine.File source =
        new BackupEngine.File(
            item.uri.toString(),
            item.size,
            item.modified,
            () -> {
              if (knownHash != null) return knownHash;
              stage.on("校验原文件");
              return catalog.hash(item, guard, hashProgress::on);
            },
            () -> catalog.stable(item));
    MultipartTransport transport =
        new MultipartTransport(
            api, mode, catalog, item, uploadProgress::on, budget, batcher);
    BackupEngine engine =
        lock == null
            ? new BackupEngine(journal, transport, guard)
            : new BackupEngine(journal, transport, guard, lock);
    for (int attempt = 1; ; attempt++) {
      try {
        return engine.process(scope, mode, source);
      } catch (Exception error) {
        if (error instanceof BackupEngine.MemoryPressure) throw error;
        if (attempt >= UploadRetryPolicy.MAX_ATTEMPTS || !UploadRetryPolicy.retryable(error))
          throw error;
        stage.on("网络波动，正在重试");
        long until = SystemClock.elapsedRealtime() + UploadRetryPolicy.delayMillis(attempt);
        while (SystemClock.elapsedRealtime() < until) {
          guard.check();
          try {
            Thread.sleep(
                Math.max(50L, Math.min(250L, until - SystemClock.elapsedRealtime())));
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw error;
          }
        }
      }
    }
  }
}
