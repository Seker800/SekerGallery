package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeAssetDetailSheet(
    asset: NativeAsset,
    model: NativeGalleryViewModel,
    onDismiss: () -> Unit,
    onOpenStack: () -> Unit,
    onEditTags: () -> Unit,
    busy: Boolean = false,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1C1C1F),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(asset.name, fontSize = 18.sp, maxLines = 2)
                    Text(
                        buildString {
                            append(asset.date)
                            if (asset.time.isNotBlank()) append(" · ${asset.time}")
                            asset.city?.let { append(" · $it") }
                        },
                        color = NativeMuted,
                        fontSize = 12.sp,
                    )
                }
                IconButton({ model.toggleFavorite(asset.id) }, enabled = !busy) {
                    Icon(
                        if (asset.favorite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                        if (asset.favorite) "取消收藏" else "收藏",
                        tint = if (asset.favorite) Color(0xFFFF8AA5) else Color.White,
                    )
                }
            }

            Text("评分", color = NativeMuted, fontSize = 12.sp)
            Row {
                (1..5).forEach { value ->
                    IconButton(
                        onClick = {
                            model.setRating(asset.id, if (asset.rating == value) null else value)
                        },
                        enabled = !busy,
                    ) {
                        Icon(
                            Icons.Outlined.Star,
                            "$value 星",
                            Modifier.size(26.dp),
                            tint =
                                if ((asset.rating ?: 0) >= value) Color(0xFFFFD166)
                                else Color.White,
                        )
                    }
                }
                if (asset.rating != null)
                    TextButton({ model.setRating(asset.id, null) }, enabled = !busy) { Text("清除") }
            }

            Text("标签", color = NativeMuted, fontSize = 12.sp)
            if (asset.tags.isEmpty())
                Text("暂无标签", color = NativeMuted)
            else
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    asset.tags.forEach { tag ->
                        AssistChip(
                            onClick = {},
                            label = { Text(tag.name) },
                            leadingIcon = {
                                Box(
                                    Modifier.size(8.dp)
                                        .background(tagChipColor(tag.color), CircleShape)
                                )
                            },
                        )
                    }
                }
            TextButton(onEditTags, enabled = !busy) { Text("编辑标签") }

            if (asset.stackId != null) {
                Text("编辑副本关系", color = NativeMuted, fontSize = 12.sp)
                TextButton({ onOpenStack() }) {
                    Text(
                        buildString {
                            append("同组 ${asset.stackAssetIds.size} 张")
                            if (asset.edited) append(" · 当前为已编辑")
                        }
                    )
                }
            }
        }
    }
}

private fun tagChipColor(value: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(NativeMuted)
