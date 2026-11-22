package com.sekereagle.android

import org.junit.Assert.*
import org.junit.Test

class NativeTagRecordTest {
    @Test
    fun onlyFavoriteAndEditedNamesAreClientSystemTags() {
        assertTrue(NativeTagRecord("a", "收藏").system)
        assertTrue(NativeTagRecord("b", "已编辑").system)
        assertFalse(NativeTagRecord("c", "旅行").system)
        assertFalse(NativeTagRecord("d", "继承私密").system)
    }

    @Test
    fun privateRuleIsCarriedIndependentlyOfTheName() {
        val private = NativeTagRecord("a", "继承私密", privateRule = true)
        assertTrue(private.privateRule)
        assertFalse(private.system)
    }
}
