package com.sekereagle.android.core;

/**
 * Per-endpoint read budgets. The API renders share JPEGs synchronously and budgets 120s for HEIC
 * decode and 180s for RAW development, so the ordinary media timeout would abort a real render.
 */
public final class NativeRequestPolicy {
  public static final int DEFAULT_READ_TIMEOUT_MS = 30_000;
  public static final int SHARE_IMAGE_READ_TIMEOUT_MS = 300_000;
  public static final int COMPLETE_READ_TIMEOUT_MS = 660_000;

  private static final String COMPLETE = "/api/(eagle|photos)/uploads/[a-fA-F0-9-]{36}/complete";
  private static final String SHARE_IMAGE =
      "/api/(eagle|photos)/assets/[a-zA-Z0-9_-]{1,100}/share-image";

  private NativeRequestPolicy() {}

  public static int readTimeoutMillis(String path) {
    String clean = path.split("\\?", 2)[0];
    if (clean.matches(COMPLETE)) return COMPLETE_READ_TIMEOUT_MS;
    if (clean.matches(SHARE_IMAGE)) return SHARE_IMAGE_READ_TIMEOUT_MS;
    return DEFAULT_READ_TIMEOUT_MS;
  }
}
