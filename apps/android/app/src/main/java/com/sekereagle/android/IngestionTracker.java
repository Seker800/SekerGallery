package com.sekereagle.android;

import android.os.SystemClock;
import java.util.*;

/**
 * Polls accepted upload sessions until the operations host finishes inspection and publication.
 * One instance per entry (backup/direct); the protocol and intervals are shared.
 */
final class IngestionTracker implements AutoCloseable {
  static final class Status {
    final String state, assetId, error;
    final int finalizationAttempts;
    final boolean objectCleanupPending;

    Status(
        String state, String assetId, String error, int finalizationAttempts, boolean cleanup) {
      this.state = state == null ? "" : state;
      this.assetId = assetId == null ? "" : assetId;
      this.error = error == null ? "" : error;
      this.finalizationAttempts = finalizationAttempts;
      this.objectCleanupPending = cleanup;
    }
  }

  interface Poll {
    Map<String, Status> query(String mode, List<String> sessionIds) throws Exception;
  }

  interface Observer {
    void completed(String sessionId);

    void failed(String sessionId, String error);

    /** The deadline elapsed; keep the session for reconciliation on the next run. */
    void stillPending(String sessionId);
  }

  interface Clock {
    long now();
  }

  static final long INTERVAL_MS = 1_500;
  static final long DEADLINE_MS = 10 * 60_000;
  private static final int BATCH_SIZE = 500;

  private static final class Tracked {
    final String mode, sessionId;
    final Observer observer;
    final long deadline;

    Tracked(String mode, String sessionId, Observer observer, long deadline) {
      this.mode = mode;
      this.sessionId = sessionId;
      this.observer = observer;
      this.deadline = deadline;
    }
  }

  private final Poll poll;
  private final long intervalMs;
  private final long deadlineMs;
  private final Clock clock;
  private final Object lock = new Object();
  private final Map<String, Tracked> tracked = new LinkedHashMap<>();
  private Thread worker;
  private volatile boolean closed;

  IngestionTracker(Poll poll) {
    this(poll, INTERVAL_MS, DEADLINE_MS);
  }

  IngestionTracker(Poll poll, long intervalMs, long deadlineMs) {
    this(poll, intervalMs, deadlineMs, SystemClock::elapsedRealtime);
  }

  IngestionTracker(Poll poll, long intervalMs, long deadlineMs, Clock clock) {
    this.poll = poll;
    this.intervalMs = Math.max(1, intervalMs);
    this.deadlineMs = Math.max(1, deadlineMs);
    this.clock = clock;
  }

  void track(String mode, String sessionId, Observer observer) {
    if (sessionId == null || sessionId.isEmpty() || observer == null) return;
    synchronized (lock) {
      if (closed) return;
      tracked.put(sessionId, new Tracked(mode, sessionId, observer, clock.now() + deadlineMs));
      if (worker == null) {
        worker = new Thread(this::loop, "ingestion-poll");
        worker.setDaemon(true);
        worker.start();
      }
      lock.notifyAll();
    }
  }

  int size() {
    synchronized (lock) {
      return tracked.size();
    }
  }

  @Override
  public void close() {
    Thread thread;
    synchronized (lock) {
      closed = true;
      tracked.clear();
      thread = worker;
      worker = null;
      lock.notifyAll();
    }
    if (thread != null) {
      thread.interrupt();
      try {
        // Callbacks write journals; they must settle before the owner closes its database.
        thread.join(5_000);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
    }
  }

  private void loop() {
    for (; ; ) {
      List<Tracked> snapshot;
      synchronized (lock) {
        while (!closed && tracked.isEmpty()) {
          try {
            lock.wait();
          } catch (InterruptedException interrupted) {
            if (closed) return;
          }
        }
        if (closed) return;
        snapshot = new ArrayList<>(tracked.values());
      }
      Map<String, List<Tracked>> byMode = new LinkedHashMap<>();
      for (Tracked item : snapshot)
        byMode.computeIfAbsent(item.mode, key -> new ArrayList<>()).add(item);
      for (Map.Entry<String, List<Tracked>> group : byMode.entrySet()) {
        List<Tracked> entries = group.getValue();
        for (int start = 0; start < entries.size(); start += BATCH_SIZE) {
          if (closed) return;
          List<Tracked> chunk =
              entries.subList(start, Math.min(entries.size(), start + BATCH_SIZE));
          List<String> ids = new ArrayList<>(chunk.size());
          for (Tracked item : chunk) ids.add(item.sessionId);
          Map<String, Status> statuses;
          try {
            statuses = poll.query(group.getKey(), ids);
          } catch (Exception transientFailure) {
            continue; // Retry on the next tick; auth loss cancels the surrounding work.
          }
          for (Tracked item : chunk) apply(item, statuses.get(item.sessionId));
        }
      }
      synchronized (lock) {
        if (closed) return;
        if (tracked.isEmpty()) {
          worker = null;
          return;
        }
        try {
          lock.wait(intervalMs);
        } catch (InterruptedException interrupted) {
          if (closed) return;
        }
      }
    }
  }

  private void apply(Tracked item, Status status) {
    if (closed || status == null) return;
    boolean done = true;
    if (status.state.equals("COMPLETED") && !status.assetId.isEmpty()) {
      item.observer.completed(item.sessionId);
    } else if (status.state.equals("ABORTED")) {
      item.observer.failed(
          item.sessionId, status.error.isEmpty() ? "上传文件校验已取消" : status.error);
    } else if (status.state.equals("FAILED")
        && (status.finalizationAttempts >= 10 || status.objectCleanupPending)) {
      item.observer.failed(item.sessionId, status.error.isEmpty() ? "上传文件校验失败" : status.error);
    } else if (clock.now() >= item.deadline) {
      item.observer.stillPending(item.sessionId);
    } else {
      done = false;
    }
    if (done) {
      synchronized (lock) {
        if (tracked.get(item.sessionId) == item) tracked.remove(item.sessionId);
      }
    }
  }
}
