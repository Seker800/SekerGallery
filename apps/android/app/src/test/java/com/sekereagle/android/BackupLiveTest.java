package com.sekereagle.android;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackupLiveTest {
  @Test
  public void largeRunsExposeCountsWithoutCopyingEveryCompletedRow() {
    BackupLive.begin("scope");
    for (int i = 0; i < 1_000; i++) {
      BackupLive.queued("content://media/" + i, "file-" + i, "PHOTO", 10);
      if (i < 900) BackupLive.finish("content://media/" + i, BackupLive.UPLOADED, "");
    }
    BackupLive.finish("content://media/999", BackupLive.FAILED, "network");
    BackupLive.Snapshot snapshot = BackupLive.snapshot(50);
    assertEquals(1_000, snapshot.total);
    assertEquals(900, snapshot.completed);
    assertEquals(1, snapshot.failed);
    assertTrue(snapshot.rows.size() <= 101);
    assertTrue(snapshot.rows.stream().noneMatch(row -> row.state.equals(BackupLive.UPLOADED) && row.name.equals("file-0")));
    assertTrue(snapshot.rows.stream().anyMatch(row -> row.name.equals("file-999")));
  }
}
