package com.sekereagle.android

import com.sekereagle.android.core.NativeRequestPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeRequestPolicyTest {
    @Test
    fun shareImagesWaitForSynchronousServerRendering() {
        assertEquals(
            NativeRequestPolicy.SHARE_IMAGE_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis(
                "/api/photos/assets/6f1c2a4e-6d0b-4a2c-9f4e-1b2c3d4e5f60/share-image"
            ),
        )
        assertEquals(
            NativeRequestPolicy.SHARE_IMAGE_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis("/api/eagle/assets/asset-1/share-image"),
        )
        assertEquals(
            NativeRequestPolicy.SHARE_IMAGE_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis("/api/photos/assets/asset-1/share-image?v=2"),
        )
    }

    @Test
    fun ordinaryMediaKeepsTheShortReadTimeout() {
        assertEquals(
            NativeRequestPolicy.DEFAULT_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis(
                "/api/photos/assets/asset-1/renditions/rendition-1/content"
            ),
        )
        assertEquals(
            NativeRequestPolicy.DEFAULT_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis("/api/eagle/assets?limit=60"),
        )
    }

    @Test
    fun uploadCompletionKeepsItsLongBudget() {
        assertEquals(
            NativeRequestPolicy.COMPLETE_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis(
                "/api/photos/uploads/6f1c2a4e-6d0b-4a2c-9f4e-1b2c3d4e5f60/complete"
            ),
        )
    }

    @Test
    fun lookalikePathsDoNotInheritLongBudgets() {
        assertEquals(
            NativeRequestPolicy.DEFAULT_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis("/api/photos/assets/asset-1/share-image-extra"),
        )
        assertEquals(
            NativeRequestPolicy.DEFAULT_READ_TIMEOUT_MS,
            NativeRequestPolicy.readTimeoutMillis("/api/photos/assets/asset-1/share-image/content"),
        )
    }
}
