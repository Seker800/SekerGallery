package com.sekereagle.android;

import static org.junit.Assert.*;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class IngestionTrackerTest {

  private static IngestionTracker.Status status(String state, String assetId) {
    return new IngestionTracker.Status(state, assetId, "", 0, false);
  }

  @Test
  public void completedSessionsCallBackOnceAndStopPolling() throws Exception {
    AtomicInteger polls = new AtomicInteger();
    CountDownLatch completed = new CountDownLatch(1);
    IngestionTracker tracker =
        new IngestionTracker(
            (mode, ids) -> {
              polls.incrementAndGet();
              Map<String, IngestionTracker.Status> result = new ConcurrentHashMap<>();
              for (String id : ids) result.put(id, status("COMPLETED", "asset-1"));
              return result;
            },
            20,
            5_000,
            () -> 0);
    try {
      tracker.track(
          "PHOTO",
          "session-1",
          new IngestionTracker.Observer() {
            public void completed(String sessionId) {
              completed.countDown();
            }

            public void failed(String sessionId, String error) {
              fail(error);
            }

            public void stillPending(String sessionId) {
              fail("unexpected");
            }
          });
      assertTrue(completed.await(2, TimeUnit.SECONDS));
      assertTrue(waitUntil(() -> tracker.size() == 0));
      int settled = polls.get();
      Thread.sleep(100);
      assertEquals(settled, polls.get());
    } finally {
      tracker.close();
    }
  }

  @Test
  public void terminalFailuresAndAbortsBecomeFailures() throws Exception {
    CountDownLatch failed = new CountDownLatch(2);
    IngestionTracker tracker =
        new IngestionTracker(
            (mode, ids) -> {
              Map<String, IngestionTracker.Status> result = new ConcurrentHashMap<>();
              for (String id : ids)
                result.put(
                    id,
                    id.equals("aborted")
                        ? new IngestionTracker.Status("ABORTED", "", "已取消", 0, false)
                        : new IngestionTracker.Status("FAILED", "", "被拒绝", 10, false));
              return result;
            },
            20,
            5_000,
            () -> 0);
    IngestionTracker.Observer observer =
        new IngestionTracker.Observer() {
          public void completed(String sessionId) {
            fail("unexpected");
          }

          public void failed(String sessionId, String error) {
            assertFalse(error.isEmpty());
            failed.countDown();
          }

          public void stillPending(String sessionId) {
            fail("unexpected");
          }
        };
    try {
      tracker.track("PHOTO", "aborted", observer);
      tracker.track("PHOTO", "failed", observer);
      assertTrue(failed.await(2, TimeUnit.SECONDS));
    } finally {
      tracker.close();
    }
  }

  @Test
  public void transientPollFailuresRetryOnTheNextTick() throws Exception {
    AtomicInteger polls = new AtomicInteger();
    CountDownLatch completed = new CountDownLatch(1);
    IngestionTracker tracker =
        new IngestionTracker(
            (mode, ids) -> {
              if (polls.incrementAndGet() < 3) throw new IllegalStateException("offline");
              Map<String, IngestionTracker.Status> result = new ConcurrentHashMap<>();
              for (String id : ids) result.put(id, status("COMPLETED", "asset-1"));
              return result;
            },
            20,
            5_000,
            () -> 0);
    try {
      tracker.track(
          "PHOTO",
          "session-1",
          new IngestionTracker.Observer() {
            public void completed(String sessionId) {
              completed.countDown();
            }

            public void failed(String sessionId, String error) {
              fail(error);
            }

            public void stillPending(String sessionId) {
              fail("unexpected");
            }
          });
      assertTrue(completed.await(2, TimeUnit.SECONDS));
      assertTrue(polls.get() >= 3);
    } finally {
      tracker.close();
    }
  }

  @Test
  public void deadlineKeepsTheSessionPendingForTheNextRun() throws Exception {
    long[] now = {0};
    CountDownLatch pending = new CountDownLatch(1);
    IngestionTracker tracker =
        new IngestionTracker(
            (mode, ids) -> {
              Map<String, IngestionTracker.Status> result = new ConcurrentHashMap<>();
              for (String id : ids) result.put(id, status("FINALIZING", ""));
              return result;
            },
            20,
            100,
            () -> now[0]);
    try {
      tracker.track(
          "PHOTO",
          "session-1",
          new IngestionTracker.Observer() {
            public void completed(String sessionId) {
              fail("unexpected");
            }

            public void failed(String sessionId, String error) {
              fail(error);
            }

            public void stillPending(String sessionId) {
              pending.countDown();
            }
          });
      now[0] = 1_000;
      assertTrue(pending.await(2, TimeUnit.SECONDS));
      assertTrue(waitUntil(() -> tracker.size() == 0));
    } finally {
      tracker.close();
    }
  }

  @Test
  public void closeStopsCallbacks() throws Exception {
    AtomicInteger callbacks = new AtomicInteger();
    IngestionTracker tracker =
        new IngestionTracker(
            (mode, ids) -> {
              Map<String, IngestionTracker.Status> result = new ConcurrentHashMap<>();
              for (String id : ids) result.put(id, status("COMPLETED", "asset-1"));
              return result;
            },
            500,
            5_000,
            () -> 0);
    tracker.track(
        "PHOTO",
        "session-1",
        new IngestionTracker.Observer() {
          public void completed(String sessionId) {
            callbacks.incrementAndGet();
          }

          public void failed(String sessionId, String error) {}

          public void stillPending(String sessionId) {}
        });
    tracker.close();
    Thread.sleep(150);
    assertEquals(0, callbacks.get());
    assertEquals(0, tracker.size());
  }

  private static boolean waitUntil(java.util.function.BooleanSupplier condition) throws Exception {
    for (int i = 0; i < 100; i++) {
      if (condition.getAsBoolean()) return true;
      Thread.sleep(20);
    }
    return false;
  }
}
