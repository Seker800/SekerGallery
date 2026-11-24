package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class UploadBudgetTest {

  @Test
  public void defaultAllowanceIsFourFilesAndSixtyFourMiB() {
    UploadBudget budget = new UploadBudget();
    assertEquals(4, budget.fileLimit());
    assertEquals(64L * 1024 * 1024, budget.byteLimit());
    assertFalse(budget.degraded());
  }

  @Test
  public void lowRamDevicesStartAtTwoFilesAndThirtyTwoMiB() {
    UploadBudget budget = new UploadBudget();
    budget.configureLowRam(true);
    assertEquals(2, budget.fileLimit());
    assertEquals(32L * 1024 * 1024, budget.byteLimit());
  }

  @Test
  public void degradedBatchFallsBackToOneFileAndTwentyFourMiBUntilReset() throws Exception {
    UploadBudget budget = new UploadBudget();
    budget.acquireFile();
    budget.acquireFile();
    budget.degradeForBatch();
    assertEquals(1, budget.fileLimit());
    assertEquals(24L * 1024 * 1024, budget.byteLimit());

    AtomicBoolean acquired = new AtomicBoolean();
    Thread waiter =
        new Thread(
            () -> {
              try {
                budget.acquireFile();
                acquired.set(true);
              } catch (InterruptedException ignored) {
              }
            });
    waiter.start();
    Thread.sleep(100);
    assertFalse(acquired.get());
    budget.releaseFile();
    budget.releaseFile();
    waiter.join(2000);
    assertTrue(acquired.get());

    budget.resetForBatch();
    assertEquals(4, budget.fileLimit());
  }

  @Test
  public void fileSlotsBlockAtTheLimitAndWakeOnRelease() throws Exception {
    UploadBudget budget = new UploadBudget();
    for (int i = 0; i < UploadBudget.NORMAL_FILES; i++) budget.acquireFile();
    CountDownLatch acquired = new CountDownLatch(1);
    Thread waiter =
        new Thread(
            () -> {
              try {
                budget.acquireFile();
                acquired.countDown();
              } catch (InterruptedException ignored) {
              }
            });
    waiter.start();
    assertFalse(acquired.await(150, TimeUnit.MILLISECONDS));
    budget.releaseFile();
    assertTrue(acquired.await(2, TimeUnit.SECONDS));
    waiter.interrupt();
  }

  @Test
  public void byteClaimsAreRoundedToOneMiBAndBounded() throws Exception {
    UploadBudget budget = new UploadBudget();
    assertEquals(1, UploadBudget.units(1));
    assertEquals(2, UploadBudget.units(1024 * 1024 + 1));
    budget.claimBytes(16L * 1024 * 1024);
    budget.claimBytes(48L * 1024 * 1024);
    AtomicInteger claims = new AtomicInteger();
    Thread waiter =
        new Thread(
            () -> {
              try {
                budget.claimBytes(1);
                claims.incrementAndGet();
              } catch (InterruptedException ignored) {
              }
            });
    waiter.start();
    Thread.sleep(100);
    assertEquals(0, claims.get());
    budget.releaseBytes(1);
    waiter.join(2000);
    assertEquals(1, claims.get());
  }

  @Test
  public void partsLargerThanTheWholeBudgetFailClosed() {
    UploadBudget budget = new UploadBudget();
    assertThrows(IllegalArgumentException.class, () -> budget.claimBytes(65L * 1024 * 1024));
  }

  @Test
  public void releaseWithoutClaimsNeverGoesNegative() {
    UploadBudget budget = new UploadBudget();
    budget.releaseFile();
    budget.releaseBytes(1024 * 1024);
    assertEquals(4, budget.fileLimit());
  }
}
