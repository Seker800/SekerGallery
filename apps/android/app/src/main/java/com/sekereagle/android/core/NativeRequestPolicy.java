package com.sekereagle.android.core;

/**
 * Per-endpoint read budgets. Share rendering is a small job; only its permanent rendition download
 * is a large media response, so the job start/status keep the ordinary deadline.
 */
public final class NativeRequestPolicy {
  public static final int DEFAULT_READ_TIMEOUT_MS = 30_000;
  public static final int SHARE_RENDITION_READ_TIMEOUT_MS = 300_000;
  public static final int COMPLETE_READ_TIMEOUT_MS = 660_000;

  private static final String COMPLETE = "/api/(eagle|photos)/uploads/[a-fA-F0-9-]{36}/complete";
  private static final String SHARE_RENDITION =
      "/api/(eagle|photos)/assets/[a-zA-Z0-9_-]{1,100}/renditions/[a-zA-Z0-9_-]{1,100}/content";

  private NativeRequestPolicy() {}

  public static int readTimeoutMillis(String path) {
    String clean = path.split("\\?", 2)[0];
    if (clean.matches(COMPLETE)) return COMPLETE_READ_TIMEOUT_MS;
    if (clean.matches(SHARE_RENDITION)) return SHARE_RENDITION_READ_TIMEOUT_MS;
    return DEFAULT_READ_TIMEOUT_MS;
  }
}
