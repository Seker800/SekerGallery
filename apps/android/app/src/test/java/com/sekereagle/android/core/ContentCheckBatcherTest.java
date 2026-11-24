package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class ContentCheckBatcherTest {

  @Test
  public void concurrentChecksShareOneBatchRequest() throws Exception {
    AtomicInteger calls = new AtomicInteger();
    CountDownLatch release = new CountDownLatch(1);
    ContentCheckBatcher batcher =
        new ContentCheckBatcher(
            items -> {
              calls.incrementAndGet();
              release.countDown();
              boolean[] results = new boolean[items.size()];
              for (int i = 0; i < items.size(); i++) results[i] = i == 1;
              return results;
            });
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<Boolean> first = pool.submit(() -> batcher.check("a".repeat(64), 12));
      Future<Boolean> second = pool.submit(() -> batcher.check("b".repeat(64), 13));
      assertTrue(release.await(2, TimeUnit.SECONDS));
      assertFalse(first.get(2, TimeUnit.SECONDS));
      assertTrue(second.get(2, TimeUnit.SECONDS));
      assertEquals(1, calls.get());
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  public void failedChecksFailOpen() throws Exception {
    ContentCheckBatcher batcher =
        new ContentCheckBatcher(
            items -> {
              throw new IllegalStateException("offline");
            });
    assertFalse(batcher.check("c".repeat(64), 12));
  }

  @Test
  public void fiftyItemsFlushWithoutWaitingForTheTimer() throws Exception {
    AtomicInteger batches = new AtomicInteger();
    AtomicInteger items = new AtomicInteger();
    ContentCheckBatcher batcher =
        new ContentCheckBatcher(
            list -> {
              assertTrue(list.size() <= ContentCheckBatcher.BATCH_SIZE);
              batches.incrementAndGet();
              items.addAndGet(list.size());
              return new boolean[list.size()];
            });
    ExecutorService pool = Executors.newFixedThreadPool(ContentCheckBatcher.BATCH_SIZE);
    try {
      List<Future<Boolean>> futures =
          new java.util.ArrayList<>(ContentCheckBatcher.BATCH_SIZE);
      for (int i = 0; i < ContentCheckBatcher.BATCH_SIZE; i++)
        futures.add(pool.submit(() -> batcher.check("d".repeat(64), 12)));
      for (Future<Boolean> future : futures) assertFalse(future.get(2, TimeUnit.SECONDS));
      assertEquals(ContentCheckBatcher.BATCH_SIZE, items.get());
      assertTrue(batches.get() < ContentCheckBatcher.BATCH_SIZE);
    } finally {
      pool.shutdownNow();
    }
  }
}
