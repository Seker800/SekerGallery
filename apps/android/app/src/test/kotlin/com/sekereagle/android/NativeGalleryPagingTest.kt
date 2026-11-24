package com.sekereagle.android

import org.junit.Assert.*
import org.junit.Test

class NativeGalleryPagingTest {
    private fun asset(id: String, date: String = "day-1") =
        NativeAsset(id, id, date, "", 1, 1, null, null, false, 1)

    @Test
    fun appendKeepsLoadedInstancesAndAddsEachNewIdOnlyOnce() {
        val first = asset("a")
        val second = asset("b")
        val existing = listOf(first, second)
        val duplicateOfSecond = asset("b")
        val appended = asset("c")
        val third = asset("d")

        val merged =
            appendNewAssets(
                existing,
                listOf(duplicateOfSecond, appended, appended, third),
            )

        assertEquals(listOf("a", "b", "c", "d"), merged.map { it.id })
        assertEquals(4, merged.size)
        assertSame(first, merged[0])
        assertSame(second, merged[1])
        assertSame(appended, merged[2])
        assertSame(third, merged[3])
    }

    @Test
    fun appendReusesTheOriginalListWhenThePageAddsNothing() {
        val existing = listOf(asset("a"), asset("b"))

        assertSame(existing, appendNewAssets(existing, emptyList()))
        assertSame(existing, appendNewAssets(existing, listOf(asset("a"), asset("b"))))
        val empty = emptyList<NativeAsset>()
        assertSame(empty, appendNewAssets(empty, emptyList()))
    }

    @Test
    fun firstPageDeduplicatesRepeatedIds() {
        val kept = asset("a")
        val merged = appendNewAssets(emptyList(), listOf(kept, asset("a"), asset("b")))

        assertEquals(listOf("a", "b"), merged.map { it.id })
        assertSame(kept, merged[0])
    }

    @Test
    fun gridEntriesKeepDateHeadersBeforeTheirAssetsInOrder() {
        val items =
            listOf(
                asset("a", "day-1"),
                asset("b", "day-1"),
                asset("c", "day-2"),
            )
        val layout = NativeGridLayout(items, true, leadingItems = 0)

        val entries = buildNativeGridEntries(items, layout.dayStarts, "PHOTO")

        assertEquals(
            listOf("date:a", "PHOTO:a", "PHOTO:b", "date:c", "PHOTO:c"),
            entries.map { it.key },
        )
        assertEquals(
            listOf(true, false, false, true, false),
            entries.map { it is NativeGridEntry.Header },
        )
        assertEquals("day-1", (entries[0] as NativeGridEntry.Header).date)
        assertSame(items[0], (entries[1] as NativeGridEntry.Asset).item)
        assertSame(items[2], (entries[4] as NativeGridEntry.Asset).item)
    }

    @Test
    fun materialEntriesCarryNoDateHeadersAndKeepStableKeysAcrossPages() {
        val firstPage = listOf(asset("a"), asset("b"))
        val secondPage = firstPage + asset("c")
        val firstLayout = NativeGridLayout(firstPage, false, leadingItems = 0)
        val secondLayout = NativeGridLayout(secondPage, false, leadingItems = 0)

        val first = buildNativeGridEntries(firstPage, firstLayout.dayStarts, "MATERIAL")
        val second = buildNativeGridEntries(secondPage, secondLayout.dayStarts, "MATERIAL")

        assertTrue(first.none { it is NativeGridEntry.Header })
        assertEquals(listOf("MATERIAL:a", "MATERIAL:b"), first.map { it.key })
        assertEquals(first.map { it.key }, second.take(first.size).map { it.key })
        assertEquals(listOf("MATERIAL:a", "MATERIAL:b", "MATERIAL:c"), second.map { it.key })
        assertEquals(second.size, second.map { it.key }.toSet().size)
    }

    @Test
    fun appendedPageKeepsExistingEntryKeysUnchanged() {
        val firstPage = listOf(asset("a", "day-1"), asset("b", "day-1"))
        val secondPage = firstPage + asset("c", "day-2")
        val before =
            buildNativeGridEntries(
                firstPage,
                NativeGridLayout(firstPage, true, leadingItems = 0).dayStarts,
                "PHOTO",
            )
        val after =
            buildNativeGridEntries(
                secondPage,
                NativeGridLayout(secondPage, true, leadingItems = 0).dayStarts,
                "PHOTO",
            )

        assertEquals(before.map { it.key }, after.take(before.size).map { it.key })
        assertEquals(listOf("date:a", "PHOTO:a", "PHOTO:b", "date:c", "PHOTO:c"), after.map { it.key })
    }
}
