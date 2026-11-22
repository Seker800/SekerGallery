package com.sekereagle.android;

import java.util.*;

/** Per-file state of the current backup run; durable failures stay in BackupJournal. */
public final class BackupLive {
  public static final String QUEUED = "QUEUED";
  public static final String UPLOADING = "UPLOADING";
  public static final String UPLOADED = "UPLOADED";
  public static final String SKIPPED = "SKIPPED";
  public static final String FAILED = "FAILED";

  public static final class Row {
    public final String uri, name, mode;
    public final long size;
    public String state = QUEUED;
    public String error = "";
    public long bytes;

    Row(String uri, String name, String mode, long size) {
      this.uri = uri;
      this.name = name;
      this.mode = mode;
      this.size = size;
    }

    Row copy() {
      Row copy = new Row(uri, name, mode, size);
      copy.state = state;
      copy.error = error;
      copy.bytes = bytes;
      return copy;
    }
  }

  public static final class Snapshot {
    public final String scope, message;
    public final boolean running;
    public final List<Row> rows;
    public final int total, completed, failed, queued;

    Snapshot(
        String scope,
        String message,
        boolean running,
        List<Row> rows,
        int total,
        int completed,
        int failed,
        int queued) {
      this.scope = scope;
      this.message = message;
      this.running = running;
      this.rows = rows;
      this.total = total;
      this.completed = completed;
      this.failed = failed;
      this.queued = queued;
    }
  }

  private static final Object lock = new Object();
  private static final LinkedHashMap<String, Row> rows = new LinkedHashMap<>();
  private static String scope = "";
  private static String message = "";
  private static boolean running;

  private BackupLive() {}

  public static void begin(String value) {
    synchronized (lock) {
      rows.clear();
      scope = value;
      message = "正在准备扫描";
      running = true;
    }
  }

  public static void message(String text) {
    synchronized (lock) {
      message = text;
    }
  }

  public static void queued(String uri, String name, String mode, long size) {
    synchronized (lock) {
      if (!rows.containsKey(uri)) rows.put(uri, new Row(uri, name, mode, size));
    }
  }

  public static void start(String uri) {
    synchronized (lock) {
      Row row = rows.get(uri);
      if (row == null) return;
      row.state = UPLOADING;
      row.error = "";
      row.bytes = 0;
    }
  }

  /** Cumulative bytes read from the source for this attempt; parallel parts keep climbing. */
  public static void progress(String uri, long bytes) {
    synchronized (lock) {
      Row row = rows.get(uri);
      if (row == null) return;
      row.bytes = Math.max(row.bytes, Math.min(bytes, row.size));
    }
  }

  public static void finish(String uri, String state, String error) {
    synchronized (lock) {
      Row row = rows.get(uri);
      if (row == null) return;
      row.state = state;
      row.error = error == null ? "" : error;
      if (state.equals(UPLOADED) || state.equals(SKIPPED)) row.bytes = row.size;
    }
  }

  public static void end(String text) {
    synchronized (lock) {
      running = false;
      message = text;
    }
  }

  public static Snapshot snapshot() {
    return snapshot(600);
  }

  /**
   * A bounded projection for the transfer page. Counts cover the whole run, while the row list
   * keeps active files plus a small completed tail; a 50k-file scan must not copy 50k rows every
   * 400 ms.
   */
  public static Snapshot snapshot(int limit) {
    synchronized (lock) {
      int total = rows.size();
      int completed = 0;
      int failed = 0;
      int queued = 0;
      List<Row> failedRows = new ArrayList<>();
      List<Row> uploading = new ArrayList<>();
      List<Row> waiting = new ArrayList<>();
      LinkedList<Row> done = new LinkedList<>();
      for (Row row : rows.values()) {
        if (row.state.equals(UPLOADED) || row.state.equals(SKIPPED)) {
          completed++;
          done.addLast(row);
          if (done.size() > 100) done.removeFirst();
        } else if (row.state.equals(FAILED)) {
          failed++;
          failedRows.add(row);
        } else if (row.state.equals(UPLOADING)) {
          queued++;
          uploading.add(row);
        } else {
          queued++;
          waiting.add(row);
        }
      }
      int activeLimit = Math.max(1, limit - done.size());
      List<Row> copy = new ArrayList<>(Math.min(activeLimit, failedRows.size() + uploading.size() + waiting.size()) + done.size());
      for (Row row : failedRows) {
        if (copy.size() >= activeLimit) break;
        copy.add(row.copy());
      }
      for (Row row : uploading) {
        if (copy.size() >= activeLimit) break;
        copy.add(row.copy());
      }
      for (Row row : waiting) {
        if (copy.size() >= activeLimit) break;
        copy.add(row.copy());
      }
      for (Row row : done) copy.add(row.copy());
      return new Snapshot(scope, message, running, copy, total, completed, failed, queued);
    }
  }
}
