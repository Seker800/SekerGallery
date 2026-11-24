package com.sekereagle.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeRenditionSelectionTest {
    private data class Rendition(val variant: String, val width: Int)

    private val thumbnails =
        listOf(Rendition("512", 512), Rendition("256", 256), Rendition("unknown", 0))

    @Test
    fun smallestCoveringWidthWins() {
        assertEquals(
            "256",
            selectByWidth(thumbnails, 256) { it.width }?.variant,
        )
        assertEquals(
            "512",
            selectByWidth(thumbnails, 300) { it.width }?.variant,
        )
    }

    @Test
    fun largestAvailableRenditionCoversSmallLibraries() {
        assertEquals(
            "512",
            selectByWidth(thumbnails, 2048) { it.width }?.variant,
        )
        assertEquals(
            "unknown",
            selectByWidth(listOf(Rendition("unknown", 0)), 256) { it.width }?.variant,
        )
        assertNull(selectByWidth(emptyList<Rendition>(), 256) { it.width })
    }
}
