package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeStackSheet(
    asset: NativeAsset,
    mode: GalleryMode,
    repo: NativeGalleryRepository,
    onSelect: (NativeAsset) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1C1C1F),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp)
        ) {
            Text("同组 ${asset.stackAssetIds.size} 张", fontSize = 18.sp)
            Text(
                if (asset.stackHasEditedMember) "原片和编辑副本保留在同一组，不会当成无关照片。"
                else "这些照片被归为同一组。",
                color = NativeMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                items(asset.stackAssetIds, key = { it }) { id ->
                    StackMemberRow(
                        id = id,
                        current = asset,
                        mode = mode,
                        repo = repo,
                        onSelect = onSelect,
                    )
                }
            }
        }
    }
}

@Composable
private fun StackMemberRow(
    id: String,
    current: NativeAsset,
    mode: GalleryMode,
    repo: NativeGalleryRepository,
    onSelect: (NativeAsset) -> Unit,
) {
    var member by remember(id) { mutableStateOf(if (id == current.id) current else null) }
    var failed by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id) {
        if (member != null) return@LaunchedEffect
        member =
            withContext(Dispatchers.IO) {
                    runCatching { repo.detail(mode, id) }
                        .getOrNull()
                        ?.copy(
                            stackId = current.stackId,
                            stackAssetIds = current.stackAssetIds,
                            stackBestAssetId = current.stackBestAssetId,
                            stackCoverId = current.stackCoverId,
                            stackHasEditedMember = current.stackHasEditedMember,
                        )
                }
                .also { failed = it == null }
    }
    val value = member
    Row(
        Modifier.fillMaxWidth()
            .clickable(enabled = value != null) { value?.let(onSelect) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (value?.thumbnail != null)
            NativeImage(
                repo = repo,
                path = value.thumbnail,
                full = false,
                name = value.name,
                modifier = Modifier.size(56.dp).background(Color(0xFF26262B)),
                scale = ContentScale.Crop,
                cacheVersion = value.cacheVersion,
            )
        else
            Box(
                Modifier.size(56.dp).background(Color(0xFF26262B)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Image, null, Modifier.size(20.dp), tint = NativeMuted)
            }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(
                when {
                    failed -> "无法读取"
                    value == null -> "正在读取…"
                    value.edited -> "已编辑"
                    current.stackHasEditedMember -> "原片"
                    else -> "同组"
                },
                fontSize = 15.sp,
            )
            Text(
                value?.let { it.date + if (it.time.isBlank()) "" else " · ${it.time}" }
                    ?: id.take(8),
                color = NativeMuted,
                fontSize = 12.sp,
            )
        }
        if (value?.id == current.stackBestAssetId)
            Icon(
                Icons.Outlined.Star,
                "当前主图",
                Modifier.size(18.dp),
                tint = Color(0xFFFFD166),
            )
        if (value?.id == current.id)
            Text("当前", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
    }
}
