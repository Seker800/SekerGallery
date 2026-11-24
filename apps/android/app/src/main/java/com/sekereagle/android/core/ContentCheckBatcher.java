package com.sekereagle.android.core;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Merges per-file dedupe checks into one request (at most 50 items or 80 ms apart). A failed
 * batch fails open: those files upload and the server still dedupes at publication.
 */
public final class ContentCheckBatcher {
  public interface Remote {
    boolean[] exists(List<Item> items) throws Exception;
  }

  public static final class Item {
    public final String hash;
    public final long size;

    public Item(String hash, long size) {
      this.hash = hash;
      this.size = size;
    }
  }

  public static final int BATCH_SIZE = 50;
  public static final long FLUSH_MILLIS = 80;

  private static final ScheduledExecutorService TIMER =
      Executors.newSingleThreadScheduledExecutor(
          runnable -> {
            Thread thread = new Thread(runnable, "content-check-batch");
            thread.setDaemon(true);
            return thread;
          });

  private final Remote remote;
  private final Object lock = new Object();
  private final List<Waiter> pending = new ArrayList<>();
  private ScheduledFuture<?> scheduled;

  public ContentCheckBatcher(Remote remote) {
    this.remote = remote;
  }

  public boolean check(String hash, long size) throws Exception {
    Waiter waiter = new Waiter(hash, size);
    List<Waiter> immediate = null;
    synchronized (lock) {
      pending.add(waiter);
      if (pending.size() >= BATCH_SIZE) immediate = takeLocked();
      else if (scheduled == null)
        scheduled =
            TIMER.schedule(this::flush, FLUSH_MILLIS, TimeUnit.MILLISECONDS);
    }
    if (immediate != null) run(immediate);
    return waiter.await();
  }

  private void flush() {
    List<Waiter> batch;
    synchronized (lock) {
      scheduled = null;
      batch = takeLocked();
    }
    run(batch);
  }

  private List<Waiter> takeLocked() {
    if (pending.isEmpty()) return List.of();
    int count = Math.min(BATCH_SIZE, pending.size());
    List<Waiter> batch = new ArrayList<>(pending.subList(0, count));
    pending.subList(0, count).clear();
    if (!pending.isEmpty() && scheduled == null)
      scheduled = TIMER.schedule(this::flush, FLUSH_MILLIS, TimeUnit.MILLISECONDS);
    return batch;
  }

  private void run(List<Waiter> batch) {
    if (batch.isEmpty()) return;
    boolean[] results = null;
    try {
      List<Item> items = new ArrayList<>(batch.size());
      for (Waiter waiter : batch) items.add(waiter.item);
      results = remote.exists(items);
    } catch (Exception ignored) {
      // Fail open: the shared publication transaction remains the authority.
    }
    for (int index = 0; index < batch.size(); index++)
      batch
          .get(index)
          .complete(results != null && index < results.length && results[index]);
  }

  private static final class Waiter {
    final Item item;
    boolean done;
    boolean exists;

    Waiter(String hash, long size) {
      this.item = new Item(hash, size);
    }

    synchronized void complete(boolean value) {
      done = true;
      exists = value;
      notifyAll();
    }

    synchronized boolean await() throws InterruptedException {
      while (!done) wait();
      return exists;
    }
  }
}
