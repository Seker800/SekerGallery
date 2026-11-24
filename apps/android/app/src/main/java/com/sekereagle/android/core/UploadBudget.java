package com.sekereagle.android.core;

import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

/**
 * One process-wide upload allowance: files and part-buffer bytes in flight. The limits track the
 * phone's per-app heap, not a user quota; waiting workers resume as soon as a slot is released.
 */
public final class UploadBudget {
  public static final int NORMAL_FILES = 4;
  public static final int LOW_RAM_FILES = 2;
  public static final int DEGRADED_FILES = 1;
  public static final long NORMAL_BYTES = 64L * 1024 * 1024;
  public static final long LOW_RAM_BYTES = 32L * 1024 * 1024;
  public static final long DEGRADED_BYTES = 24L * 1024 * 1024;
  private static final long UNIT = 1024 * 1024;

  private static final UploadBudget shared = new UploadBudget();

  public static UploadBudget shared() {
    return shared;
  }

  private final ReentrantLock lock = new ReentrantLock(true);
  private final Condition changed = lock.newCondition();
  private boolean lowRam;
  private boolean degraded;
  private int filesInUse;
  private long bytesInUse;

  public UploadBudget() {}

  public void configureLowRam(boolean value) {
    lock.lock();
    try {
      lowRam = value;
      changed.signalAll();
    } finally {
      lock.unlock();
    }
  }

  public boolean lowRam() {
    lock.lock();
    try {
      return lowRam;
    } finally {
      lock.unlock();
    }
  }

  public boolean degraded() {
    lock.lock();
    try {
      return degraded;
    } finally {
      lock.unlock();
    }
  }

  /** The current batch hit a memory warning; the rest of it runs at the smallest allowance. */
  public void degradeForBatch() {
    lock.lock();
    try {
      degraded = true;
      changed.signalAll();
    } finally {
      lock.unlock();
    }
  }

  public void resetForBatch() {
    lock.lock();
    try {
      degraded = false;
      changed.signalAll();
    } finally {
      lock.unlock();
    }
  }

  public int fileLimit() {
    lock.lock();
    try {
      return degraded ? DEGRADED_FILES : lowRam ? LOW_RAM_FILES : NORMAL_FILES;
    } finally {
      lock.unlock();
    }
  }

  public long byteLimit() {
    lock.lock();
    try {
      return degraded ? DEGRADED_BYTES : lowRam ? LOW_RAM_BYTES : NORMAL_BYTES;
    } finally {
      lock.unlock();
    }
  }

  public void acquireFile() throws InterruptedException {
    lock.lockInterruptibly();
    try {
      while (filesInUse >= fileLimit()) changed.await();
      filesInUse++;
    } finally {
      lock.unlock();
    }
  }

  public boolean idle() {
    lock.lock();
    try {
      return filesInUse == 0 && bytesInUse == 0;
    } finally {
      lock.unlock();
    }
  }

  public void releaseFile() {
    lock.lock();
    try {
      if (filesInUse > 0) filesInUse--;
      changed.signalAll();
    } finally {
      lock.unlock();
    }
  }

  public void claimBytes(long bytes) throws InterruptedException {
    long units = units(bytes);
    lock.lockInterruptibly();
    try {
      if (units > units(byteLimit())) throw new IllegalArgumentException("分片缓冲超出预算");
      while (bytesInUse + units > units(byteLimit())) changed.await();
      bytesInUse += units;
    } finally {
      lock.unlock();
    }
  }

  public void releaseBytes(long bytes) {
    long units = units(bytes);
    lock.lock();
    try {
      bytesInUse = Math.max(0, bytesInUse - units);
      changed.signalAll();
    } finally {
      lock.unlock();
    }
  }

  /** Bytes are accounted in 1 MiB units so a part never claims less than it allocates. */
  public static long units(long bytes) {
    return Math.max(1, (bytes + UNIT - 1) / UNIT);
  }
}
