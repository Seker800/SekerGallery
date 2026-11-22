package com.sekereagle.android.core;

/** Chooses a system-share source without downloading an original when a smaller rendition exists. */
public final class NativeSharePolicy {
  public static final long MAX_SHARE_ORIGINAL_BYTES = 512L * 1024 * 1024;

  public enum Source {
    SHARE_IMAGE,
    PLAYBACK,
    ORIGINAL
  }

  private NativeSharePolicy() {}

  public static Source source(boolean video, String mimeType, boolean playbackReady) {
    if (video) return playbackReady ? Source.PLAYBACK : Source.ORIGINAL;
    if (mimeType == null || !mimeType.startsWith("image/")) return Source.ORIGINAL;
    // A still JPEG share would drop animation and transparency semantics.
    if (mimeType.equals("image/gif") || mimeType.equals("image/webp")) return Source.ORIGINAL;
    return Source.SHARE_IMAGE;
  }

  public static boolean fourK(int width, int height) {
    return Math.max(width, height) >= 4096;
  }

  public static String shareFileName(String originalName) {
    String name = NativeDownloadPolicy.fileName(originalName);
    int dot = name.lastIndexOf('.');
    String stem = dot > 0 ? name.substring(0, dot) : name;
    return stem.isEmpty() ? "share.jpg" : stem + ".jpg";
  }

  public static String playbackFileName(String originalName) {
    String name = NativeDownloadPolicy.fileName(originalName);
    int dot = name.lastIndexOf('.');
    String stem = dot > 0 ? name.substring(0, dot) : name;
    return stem.isEmpty() ? "share.mp4" : stem + ".mp4";
  }
}
