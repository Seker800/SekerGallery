package com.sekereagle.android;

import com.sekereagle.android.core.BackupEngine;
import com.sekereagle.android.core.ContentCheckBatcher;
import com.sekereagle.android.core.ForwardUploadSource;
import com.sekereagle.android.core.UploadBudget;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

final class MultipartTransport implements BackupEngine.Transport {
  // One shared pool for every file: at most four files x three parts can be in flight.
  private static final ExecutorService uploads =
      Executors.newFixedThreadPool(
          12,
          runnable -> {
            Thread thread = new Thread(runnable, "upload-part");
            thread.setDaemon(true);
            return thread;
          });

  private final UploadApi api;
  private final String path;
  private final MediaCatalog catalog;
  private final MediaCatalog.Item item;
  private final java.util.function.LongConsumer progress;
  private final UploadBudget budget;
  private final ContentCheckBatcher batcher;

  MultipartTransport(UploadApi api, String mode, MediaCatalog catalog, MediaCatalog.Item item) {
    this(api, mode, catalog, item, null);
  }

  MultipartTransport(
      UploadApi api,
      String mode,
      MediaCatalog catalog,
      MediaCatalog.Item item,
      java.util.function.LongConsumer progress) {
    this(api, mode, catalog, item, progress, UploadBudget.shared(), null);
  }

  MultipartTransport(
      UploadApi api,
      String mode,
      MediaCatalog catalog,
      MediaCatalog.Item item,
      java.util.function.LongConsumer progress,
      UploadBudget budget,
      ContentCheckBatcher batcher) {
    if (!(mode.equals("PHOTO") || mode.equals("MATERIAL")))
      throw new IllegalArgumentException("无效模式");
    this.api = api;
    this.catalog = catalog;
    this.item = item;
    this.progress = progress;
    this.budget = budget == null ? UploadBudget.shared() : budget;
    this.batcher = batcher;
    path = "/api/" + (mode.equals("PHOTO") ? "photos" : "eagle") + "/uploads";
  }

  @Override
  public boolean exists(String hash, long size) throws Exception {
    if (batcher != null) return batcher.check(hash, size);
    return api.request(
            "POST",
            path + "/check-content",
            new JSONObject().put("contentSha256", hash).put("size", size))
        .getBoolean("exists");
  }

  @Override
  public void upload(
      BackupEngine.File file,
      BackupEngine.Checkpoint cp,
      BackupEngine.Save save,
      BackupEngine.Guard guard)
      throws Exception {
    try {
      resume(file, cp, save, guard);
    } catch (ApiClient.Failure error) {
      if (error.endpoint != com.sekereagle.android.core.UploadFailure.Endpoint.API) throw error;
      if (error.permanent()) {
        if (validSession(cp.session))
          try {
            guard.check();
            api.request("DELETE", path + "/" + cp.session, null);
          } catch (Exception ignored) {
          }
        cp.session = "";
        cp.partSize = 0;
        cp.terminalError = error.getMessage();
        save.write(cp);
        throw new BackupEngine.PermanentFailure(cp.terminalError);
      }
      if (error.status == 404) {
        cp.session = "";
        cp.partSize = 0;
        save.write(cp);
      }
      if (error.status == 409 && validSession(cp.session)) {
        JSONObject current = api.request("GET", path + "/" + cp.session, null);
        if (current.optString("status").equals("COMPLETED")
            && !current.isNull("eagleAssetId")
            && !current.optString("eagleAssetId").isEmpty()) return;
        if (current.optString("status").equals("ABORTED")) {
          cp.session = "";
          cp.partSize = 0;
          save.write(cp);
        } else if (current.optString("status").equals("FAILED")
            && (current.optInt("finalizationAttempts") >= 10
                || current.optBoolean("objectCleanupPending"))) {
          cp.session = "";
          cp.partSize = 0;
          cp.terminalError = "服务器已拒绝该文件，请检查后重试失败文件";
          save.write(cp);
          throw new BackupEngine.PermanentFailure(cp.terminalError);
        }
      }
      throw error;
    }
  }

  private static boolean validSession(String value) {
    return value.matches(
        "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}");
  }

  private void resume(
      BackupEngine.File file,
      BackupEngine.Checkpoint cp,
      BackupEngine.Save save,
      BackupEngine.Guard guard)
      throws Exception {
    String status = "";
    if (!cp.session.isEmpty() && !validSession(cp.session)) {
      cp.session = "";
      cp.partSize = 0;
      save.write(cp);
    }

    if (!cp.session.isEmpty()) {
      try {
        JSONObject session = api.request("GET", path + "/" + cp.session, null);
        if (session.getLong("size") != item.size) throw new IOException("上传检查点与文件不一致");
        status = session.optString("status");
        if (status.equals("COMPLETED")) return;
        if (status.equals("ABORTED")) {
          cp.session = "";
          cp.partSize = 0;
          save.write(cp);
          status = "INITIATED";
        }
        if (status.equals("FAILED")
            && (session.optInt("finalizationAttempts") >= 10
                || session.optBoolean("objectCleanupPending"))) {
          cp.session = "";
          cp.partSize = 0;
          cp.terminalError = "服务器已拒绝该文件，请检查后重试失败文件";
          save.write(cp);
          throw new BackupEngine.PermanentFailure(cp.terminalError);
        }
        // ASSEMBLED and FINALIZING only need the ingestion poller; never re-upload them.
        if (!status.equals("INITIATED")) return;
      } catch (ApiClient.Failure e) {
        if (e.status != 404) throw e;
        cp.session = "";
        status = "INITIATED";
      }
    }
    if (cp.session.isEmpty()) {
      guard.check();
      JSONObject session =
          api.request(
              "POST",
              path,
              new JSONObject()
                  .put("originalName", item.name)
                  .put("mimeType", item.mime)
                  .put("size", item.size)
                  .put("contentSha256", cp.hash)
                  .put("duplicatePolicy", "SKIP"));
      cp.session = session.getString("id");
      cp.partSize = session.getLong("partSize");
      save.write(cp);
      status = "INITIATED";
    }
    if (!validSession(cp.session) || cp.partSize < 5_242_880 || cp.partSize > 64L * 1024 * 1024)
      throw new IOException("上传检查点无效");
    Map<Integer, JSONObject> committed = new HashMap<>();
    JSONArray inventory =
        api.request("GET", path + "/" + cp.session + "/parts", null).getJSONArray("parts");
    for (int i = 0; i < inventory.length(); i++) {
      JSONObject part = inventory.getJSONObject(i);
      committed.put(part.getInt("partNumber"), part);
    }
    JSONArray parts = new JSONArray();
    int total = (int) ((item.size + cp.partSize - 1) / cp.partSize);
    List<Integer> missing = new ArrayList<>();
    for (int number = 1; number <= total; number++) {
      guard.check();
      long offset = (number - 1L) * cp.partSize,
          length = Math.min(cp.partSize, item.size - offset);
      JSONObject part = committed.get(number);
      boolean reusable = part != null && (!part.has("size") || part.getLong("size") == length);
      if (reusable) {
        parts.put(new JSONObject().put("partNumber", number).put("etag", part.getString("etag")));
      } else {
        missing.add(number);
      }
    }
    if (missing.isEmpty()) {
      complete(cp, parts, guard);
      return;
    }
    if (!status.equals("INITIATED")) throw new IOException("上传已进入确认阶段，等待服务器恢复");

    // One request signs every remaining part; the PUTs below then run without queueing
    // control requests behind each other on the phone's connections.
    JSONArray numbers = new JSONArray();
    for (int number : missing) numbers.put(number);
    Map<Integer, String> urls = new HashMap<>();
    try {
      JSONArray signedParts =
          api.request(
                  "POST",
                  path + "/" + cp.session + "/parts",
                  new JSONObject().put("partNumbers", numbers))
              .getJSONArray("parts");
      for (int i = 0; i < signedParts.length(); i++) {
        JSONObject signed = signedParts.getJSONObject(i);
        urls.put(signed.getInt("partNumber"), signed.getString("uploadUrl"));
      }
    } catch (ApiClient.Failure failure) {
      // Older servers only expose per-part signing; keep those working during a rolling deploy.
      if (failure.status != 404 && failure.status != 405) throw failure;
    }

    ArrayDeque<Future<JSONObject>> pending = new ArrayDeque<>();
    try (ForwardUploadSource source =
        new ForwardUploadSource(catalog.open(item, 0, guard, progress))) {
      try {
        for (int number = 1; number <= total; number++) {
          guard.check();
          long offset = (number - 1L) * cp.partSize,
              length = Math.min(cp.partSize, item.size - offset);
          if (committed.containsKey(number)) continue;
          if (pending.size() == 3) parts.put(await(pending.removeFirst()));
          String resolved = urls.get(number);
          if (resolved == null)
            resolved =
                api.request(
                        "POST", path + "/" + cp.session + "/parts/" + number, new JSONObject())
                    .getString("uploadUrl");
          final String url = resolved;
          if (length <= ForwardUploadSource.MAX_BUFFER) {
            final int partNumber = number;
            final byte[] buffer = readBuffered(source, offset, (int) length, guard);
            boolean scheduled = false;
            try {
              pending.add(
                  uploads.submit(
                      () -> {
                        try {
                          return uploadPart(cp.session, partNumber, url, buffer, guard);
                        } finally {
                          budget.releaseBytes(length);
                        }
                      }));
              scheduled = true;
            } finally {
              if (!scheduled) budget.releaseBytes(length);
            }
          } else {
            // Legacy sessions may have larger parts. Stream them without a large allocation.
            while (!pending.isEmpty()) parts.put(await(pending.removeFirst()));
            guard.check();
            JSONObject signed =
                api.request(
                    "POST", path + "/" + cp.session + "/parts/" + number, new JSONObject());
            String etag =
                api.put(
                    signed.getString("uploadUrl"),
                    source.part(offset, length, guard),
                    length,
                    guard);
            parts.put(new JSONObject().put("partNumber", number).put("etag", etag));
          }
        }
        while (!pending.isEmpty()) parts.put(await(pending.removeFirst()));
      } finally {
        // Finish every in-flight write before handing a checkpoint to another run.
        while (!pending.isEmpty()) {
          try {
            await(pending.removeFirst());
          } catch (Exception ignored) {
          }
        }
      }
    }
    guard.check();
    complete(cp, parts, guard);
  }

  /**
   * Claims part-buffer bytes before allocating. A failed allocation degrades this batch once and
   * retries; a second failure pauses the batch instead of crashing the app.
   */
  private byte[] readBuffered(
      ForwardUploadSource source, long offset, int length, BackupEngine.Guard guard)
      throws Exception {
    boolean claimed = false;
    try {
      budget.claimBytes(length);
      claimed = true;
      return source.read(offset, length, guard);
    } catch (OutOfMemoryError memory) {
      if (claimed) budget.releaseBytes(length);
      claimed = false;
      budget.degradeForBatch();
      guard.check();
      Thread.sleep(2_000);
      try {
        budget.claimBytes(length);
        claimed = true;
        return source.read(offset, length, guard);
      } catch (OutOfMemoryError again) {
        if (claimed) budget.releaseBytes(length);
        throw new BackupEngine.MemoryPressure();
      } catch (Exception retryError) {
        if (claimed) budget.releaseBytes(length);
        throw retryError;
      }
    } catch (Exception error) {
      if (claimed) budget.releaseBytes(length);
      throw error;
    }
  }

  private void complete(
      BackupEngine.Checkpoint cp, JSONArray parts, BackupEngine.Guard guard) throws Exception {
    guard.check();
    // Completion only accepts the durable job; the operations host inspects and publishes later.
    // The shared ingestion tracker polls the session, so this call never waits for publication.
    api.request("POST", path + "/" + cp.session + "/complete", new JSONObject().put("parts", parts));
  }

  private JSONObject uploadPart(
      String session, int number, String url, byte[] bytes, BackupEngine.Guard guard)
      throws Exception {
    for (int attempt = 0; attempt < 2; attempt++) {
      guard.check();
      try {
        String etag = api.put(url, new ByteArrayInputStream(bytes), bytes.length, guard);
        return new JSONObject().put("partNumber", number).put("etag", etag);
      } catch (ApiClient.Failure error) {
        if (attempt != 0 || !error.renewSignature()) throw error;
        // Signed part URLs expire after 15 minutes; re-sign only the failed part.
        url =
            api.request("POST", path + "/" + session + "/parts/" + number, new JSONObject())
                .getString("uploadUrl");
      }
    }
    throw new IOException("分片未能上传");
  }

  private static JSONObject await(Future<JSONObject> future) throws Exception {
    boolean interrupted = false;
    try {
      for (; ; ) {
        try {
          return future.get();
        } catch (InterruptedException error) {
          interrupted = true;
        }
      }
    } catch (ExecutionException error) {
      if (error.getCause() instanceof Exception) throw (Exception) error.getCause();
      throw error;
    } finally {
      if (interrupted) Thread.currentThread().interrupt();
    }
  }
}
