package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class NativeSharePolicyTest {
  @Test
  public void imagesPreferTheBoundedShareRendition() {
    assertEquals(
        NativeSharePolicy.Source.SHARE_IMAGE,
        NativeSharePolicy.source(false, "image/jpeg", false));
    assertEquals(
        NativeSharePolicy.Source.SHARE_IMAGE,
        NativeSharePolicy.source(false, "image/heic", false));
    assertEquals(
        NativeSharePolicy.Source.SHARE_IMAGE,
        NativeSharePolicy.source(false, "image/x-adobe-dng", false));
  }

  @Test
  public void animationAndVideosKeepTheirCompatibleOriginalOrPlayback() {
    assertEquals(
        NativeSharePolicy.Source.ORIGINAL, NativeSharePolicy.source(false, "image/gif", false));
    assertEquals(
        NativeSharePolicy.Source.ORIGINAL, NativeSharePolicy.source(false, "image/webp", false));
    assertEquals(
        NativeSharePolicy.Source.PLAYBACK, NativeSharePolicy.source(true, "video/quicktime", true));
    assertEquals(
        NativeSharePolicy.Source.ORIGINAL, NativeSharePolicy.source(true, "video/quicktime", false));
  }

  @Test
  public void fourKLabelRequiresA4096LongEdge() {
    assertTrue(NativeSharePolicy.fourK(6000, 4000));
    assertTrue(NativeSharePolicy.fourK(4096, 100));
    assertFalse(NativeSharePolicy.fourK(4095, 4000));
  }

  @Test
  public void shareNamesAreSafeAndKeepASingleJpegExtension() {
    assertEquals("photo.jpg", NativeSharePolicy.shareFileName("../../photo.heic"));
    assertEquals("photo.jpg", NativeSharePolicy.shareFileName("photo"));
    assertEquals("clip.mp4", NativeSharePolicy.playbackFileName("a/b/clip.mov"));
    assertEquals("download.jpg", NativeSharePolicy.shareFileName("..\n"));
  }
}
