package com.sekereagle.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeAssetTagsSheet(
    asset: NativeAsset,
    mode: GalleryMode,
    repo: NativeGalleryRepository,
    model: NativeGalleryViewModel,
    onDismiss: () -> Unit,
) {
    var choices by remember(asset.id) { mutableStateOf<List<NativeTag>>(emptyList()) }
    var selected by remember(asset.id) { mutableStateOf(asset.tags.map { it.id }.toSet()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var createOpen by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun load() {
        scope.launch {
            loading = true
            try {
                val records = withContext(Dispatchers.IO) { repo.listTags(mode) }
                val current =
                    asset.tags.map { NativeTag(it.id, it.name, normalizeTagSearch(it.name)) }
                choices =
                    (records.map {
                        NativeTag(it.id, it.name, normalizeTagSearch("${it.name} ${it.pinyin}"))
                    } + current).distinctBy { it.id }
                error = null
            } catch (reason: CancellationException) {
                throw reason
            } catch (reason: Exception) {
                if (reason is NativeSession.Failure && reason.status == 401) model.logout()
                else error = reason.message ?: "标签暂时无法读取"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(asset.id) { load() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1C1C1F),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("编辑标签", fontSize = 20.sp)
                    Text("只修改这张照片", color = NativeMuted, fontSize = 12.sp)
                }
                TextButton({ createOpen = true }, enabled = !busy) { Text("新建标签") }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            NativeTagPicker(
                choices = choices,
                selected = selected,
                status = NativeOptionStatus(),
                maxHeight = 320.dp,
                enabled = !busy && !loading,
            ) { selected = it }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onDismiss, enabled = !busy) { Text("取消") }
                TextButton(
                    onClick = {
                        val chosen = choices.filter { it.id in selected }
                        val mapped =
                            chosen.map { choice ->
                                asset.tags.firstOrNull { it.id == choice.id }
                                    ?: NativeAssetTag(choice.id, choice.name)
                            } +
                                asset.tags.filter { it.id in selected && chosen.none { c -> c.id == it.id } }
                        model.applyAssetTags(asset, mapped.distinctBy { it.id })
                        onDismiss()
                    },
                    enabled = !busy && !loading,
                ) {
                    Text("应用")
                }
            }
        }
    }

    if (createOpen)
        AlertDialog(
            onDismissRequest = { if (!busy) createOpen = false },
            title = { Text("新建标签") },
            text = {
                OutlinedTextField(
                    newName,
                    { newName = it.take(64) },
                    label = { Text("名称") },
                    singleLine = true,
                    isError = newName.trim() == "收藏" || newName.trim() == "已编辑",
                    supportingText = {
                        if (newName.trim() == "收藏" || newName.trim() == "已编辑")
                            Text("收藏／已编辑是系统标签名，请换一个")
                    },
                )
            },
            dismissButton = {
                TextButton({ createOpen = false }, enabled = !busy) { Text("取消") }
            },
            confirmButton = {
                TextButton(
                    {
                        val name = newName.trim()
                        if (name.isEmpty()) return@TextButton
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                val created = withContext(Dispatchers.IO) { repo.createTag(mode, name) }
                                repo.invalidateOptions(mode)
                                val tag = NativeTag(created.id, created.name, normalizeTagSearch(created.name))
                                choices = (choices + tag).distinctBy { it.id }
                                selected = selected + created.id
                                newName = ""
                                createOpen = false
                            } catch (reason: CancellationException) {
                                throw reason
                            } catch (reason: Exception) {
                                if (reason is NativeSession.Failure && reason.status == 401)
                                    model.logout()
                                else error = reason.message ?: "标签创建失败"
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy && newName.isNotBlank() &&
                        newName.trim() != "收藏" && newName.trim() != "已编辑",
                ) { Text("创建并选中") }
            },
        )
}
