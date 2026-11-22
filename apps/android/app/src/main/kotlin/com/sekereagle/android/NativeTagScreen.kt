package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val tagColors =
    listOf(
        "#E05D5D",
        "#E0A85D",
        "#5DA85D",
        "#5D9BE0",
        "#8A5DE0",
        "#D65D9B",
        "#8B8B90",
    )

@Composable
internal fun NativeTagScreen(
    state: GalleryState,
    model: NativeGalleryViewModel,
    repo: NativeGalleryRepository,
) {
    val mode = state.mode
    var tags by remember(mode) { mutableStateOf<List<NativeTagRecord>>(emptyList()) }
    var groups by remember(mode) { mutableStateOf<List<NativeTagGroupRecord>>(emptyList()) }
    var loading by remember(mode) { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var scope by remember { mutableStateOf("ALL") }
    var editing by remember { mutableStateOf<NativeTagRecord?>(null) }
    var creating by remember { mutableStateOf(false) }
    var groupsOpen by remember { mutableStateOf(false) }
    var editingGroup by remember { mutableStateOf<NativeTagGroupRecord?>(null) }
    val scopeRunner = rememberCoroutineScope()

    suspend fun reload() {
        val result =
            withContext(Dispatchers.IO) {
                repo.listTags(mode) to repo.listTagGroups(mode)
            }
        tags = result.first
        groups = result.second
        loading = false
    }

    LaunchedEffect(mode) {
        loading = true
        error = null
        try {
            reload()
        } catch (reason: CancellationException) {
            throw reason
        } catch (reason: Exception) {
            loading = false
            if (reason is NativeSession.Failure && reason.status == 401) model.logout()
            else error = reason.message ?: "标签暂时无法读取"
        }
    }

    fun perform(block: suspend () -> String?) {
        if (busy) return
        busy = true
        error = null
        scopeRunner.launch {
            try {
                val operationId = block()
                if (operationId != null) {
                    withContext(Dispatchers.IO) {
                        repo.assetOperations.await(mode, operationId, 90_000)
                    }
                }
                repo.invalidateOptions(mode)
                repo.invalidateFavorite(mode)
                reload()
            } catch (reason: CancellationException) {
                throw reason
            } catch (reason: Exception) {
                if (reason is NativeSession.Failure && reason.status == 401) model.logout()
                else error = reason.message ?: "标签操作未完成"
            } finally {
                busy = false
            }
        }
    }

    val groupNames = groups.associate { it.id to it.name }
    val visible =
        remember(tags, query, scope) {
            val normalizedQuery = normalizeTagSearch(query)
            tags.filter { tag ->
                val group = when {
                    scope == "ALL" -> true
                    scope == "UNGROUPED" -> tag.groupId == null
                    scope == "STARRED" -> tag.isStarred
                    scope.startsWith("GROUP:") -> tag.groupId == scope.removePrefix("GROUP:")
                    else -> true
                }
                group &&
                    (normalizedQuery.isEmpty() ||
                        normalizeTagSearch("${tag.name} ${tag.pinyin} ${tag.pinyinInitials}")
                            .contains(normalizedQuery))
            }
        }

    Column(
        Modifier.fillMaxSize()
            .background(Color.Black)
            .testTag("native-tags")
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ model.closeTagScreen() }) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回图库")
            }
            Column(Modifier.weight(1f)) {
                Text("人工标签", fontSize = 21.sp)
                Text(
                    if (mode == GalleryMode.PHOTO) "照片标签" else "素材标签",
                    color = NativeMuted,
                    fontSize = 12.sp,
                )
            }
            TextButton({ groupsOpen = true }) { Text("标签组") }
            IconButton({ creating = true }, enabled = !busy) {
                Icon(Icons.Outlined.Add, "新建标签")
            }
        }
        OutlinedTextField(
            query,
            { query = it.take(100) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).testTag("tag-manage-search"),
            singleLine = true,
            placeholder = { Text("搜索标签", color = NativeMuted) },
            leadingIcon = { Icon(Icons.Outlined.Search, null, tint = NativeMuted) },
        )
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("ALL" to "全部", "UNGROUPED" to "未分组", "STARRED" to "星标")
                .forEach { (key, label) ->
                    FilterChip(
                        selected = scope == key,
                        onClick = { scope = key },
                        label = { Text(label) },
                    )
                }
            groups.forEach { group ->
                FilterChip(
                    selected = scope == "GROUP:${group.id}",
                    onClick = { scope = "GROUP:${group.id}" },
                    label = { Text(group.name) },
                )
            }
        }
        if (error != null)
            Text(
                error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (loading)
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        else
            LazyColumn(
                Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (visible.isEmpty())
                    item {
                        Text(
                            if (tags.isEmpty()) "还没有人工标签" else "没有符合搜索的标签",
                            color = NativeMuted,
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                items(visible, key = { it.id }) { tag ->
                    TagRow(
                        tag = tag,
                        groupName = tag.groupId?.let(groupNames::get),
                        onOpen = {
                            model.applyFilters(NativeFilters(tags = setOf(tag.id)))
                            model.closeTagScreen()
                        },
                        onEdit = { editing = tag },
                    )
                }
            }
        Text(
            "标签按照片／素材分开。收藏、已编辑和私密标签为只读；删除标签只解除标签关系，不删除素材。",
            color = NativeMuted,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }

    if (creating || editing != null)
        TagEditor(
            tag = editing,
            groups = groups,
            busy = busy,
            onDismiss = {
                creating = false
                editing = null
            },
            onSave = { name, color, groupId, starred ->
                val existing = editing
                creating = false
                editing = null
                perform {
                    if (existing == null) {
                        val created = repo.createTag(mode, name, color)
                        if (groupId != null || starred)
                            repo.updateTag(
                                mode,
                                created,
                                color = color,
                                groupId = groupId,
                                isStarred = starred,
                            )
                        else null
                    } else {
                        repo.updateTag(
                            mode,
                            existing,
                            name = name,
                            color = color,
                            groupId = groupId,
                            isStarred = starred,
                        )
                    }
                }
            },
            onDelete = { existing ->
                editing = null
                perform { repo.deleteTag(mode, existing) }
            },
        )

    if (groupsOpen)
        TagGroupsDialog(
            groups = groups,
            busy = busy,
            onDismiss = { groupsOpen = false },
            onCreate = { name ->
                groupsOpen = false
                perform {
                    repo.createTagGroup(mode, name)
                    null
                }
            },
            onEdit = {
                groupsOpen = false
                editingGroup = it
            },
            onDelete = { group ->
                groupsOpen = false
                perform { repo.deleteTagGroup(mode, group) }
            },
        )
    if (editingGroup != null)
        TagGroupEditor(
            group = editingGroup!!,
            busy = busy,
            onDismiss = { editingGroup = null },
            onSave = { name, color ->
                val group = editingGroup!!
                editingGroup = null
                perform {
                    repo.updateTagGroup(mode, group, name = name, color = color)
                    null
                }
            },
        )
}

@Composable
private fun TagRow(
    tag: NativeTagRecord,
    groupName: String?,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
) {
    val locked = tag.system || tag.privateRule
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(10.dp).background(tagColor(tag.color), CircleShape)
        )
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(tag.name, fontSize = 16.sp)
            Text(
                buildString {
                    append("${tag.assetCount} 项")
                    groupName?.let { append(" · $it") }
                    if (tag.privateRule) append(" · 私密规则")
                },
                color = NativeMuted,
                fontSize = 12.sp,
            )
        }
        if (tag.isStarred)
            Icon(Icons.Outlined.Star, "星标标签", Modifier.size(18.dp), tint = Color(0xFFFFD166))
        if (locked)
            Icon(Icons.Outlined.Lock, "系统标签", Modifier.size(18.dp), tint = NativeMuted)
        else
            IconButton(onClick = onEdit) {
                Icon(Icons.Outlined.MoreVert, "编辑标签", Modifier.size(20.dp))
            }
    }
}

@Composable
private fun TagEditor(
    tag: NativeTagRecord?,
    groups: List<NativeTagGroupRecord>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (String, String?, String?, Boolean) -> Unit,
    onDelete: (NativeTagRecord) -> Unit,
) {
    var name by remember(tag?.id) { mutableStateOf(tag?.name.orEmpty()) }
    var color by remember(tag?.id) { mutableStateOf(tag?.color) }
    var groupId by remember(tag?.id) { mutableStateOf(tag?.groupId) }
    var starred by remember(tag?.id) { mutableStateOf(tag?.isStarred == true) }
    var groupMenu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val systemName = name.trim() == "收藏" || name.trim() == "已编辑"
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (tag == null) "新建标签" else "编辑标签") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    name,
                    { name = it.take(64) },
                    label = { Text("名称") },
                    singleLine = true,
                    isError = name.isBlank() || systemName,
                    supportingText = {
                        if (systemName) Text("收藏／已编辑是系统标签名，请换一个")
                    },
                )
                Text("颜色", color = NativeMuted, fontSize = 12.sp)
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = color == null,
                        onClick = { color = null },
                        label = { Text("无") },
                    )
                    tagColors.forEach { value ->
                        FilterChip(
                            selected = color == value,
                            onClick = { color = value },
                            label = {
                                Box(Modifier.size(16.dp).background(tagColor(value), CircleShape))
                            },
                        )
                    }
                }
                Box {
                    TextButton({ groupMenu = true }) {
                        Text(
                            "分组：${groupId?.let { id -> groups.firstOrNull { it.id == id }?.name } ?: "未分组"}"
                        )
                    }
                    DropdownMenu(groupMenu, onDismissRequest = { groupMenu = false }) {
                        DropdownMenuItem(
                            text = { Text("未分组") },
                            onClick = {
                                groupId = null
                                groupMenu = false
                            },
                        )
                        groups.forEach { group ->
                            DropdownMenuItem(
                                text = { Text(group.name) },
                                onClick = {
                                    groupId = group.id
                                    groupMenu = false
                                },
                            )
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(starred, { starred = it }, enabled = !busy)
                    Text("星标标签")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(name.trim(), color, groupId, starred) },
                enabled = !busy && name.isNotBlank() && !systemName,
            ) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (tag != null && !tag.system && !tag.privateRule)
                    TextButton({ confirmDelete = true }, enabled = !busy) {
                        Text("删除", color = MaterialTheme.colorScheme.error)
                    }
                TextButton(onDismiss) { Text("取消") }
            }
        },
    )
    if (confirmDelete && tag != null)
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除标签？") },
            text = { Text("只会解除“${tag.name}”与素材的标签关系，不删除素材。") },
            dismissButton = { TextButton({ confirmDelete = false }) { Text("取消") } },
            confirmButton = {
                TextButton({
                    confirmDelete = false
                    onDelete(tag)
                }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
        )
}

@Composable
private fun TagGroupsDialog(
    groups: List<NativeTagGroupRecord>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
    onEdit: (NativeTagGroupRecord) -> Unit,
    onDelete: (NativeTagGroupRecord) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf<NativeTagGroupRecord?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("标签组") },
        text = {
            Column(
                Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    name,
                    { name = it.take(64) },
                    label = { Text("新建组名") },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ onCreate(name.trim()) }, enabled = name.isNotBlank() && !busy) {
                        Text("新建")
                    }
                }
                groups.forEach { group ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).background(tagColor(group.color), CircleShape))
                        Text(group.name, Modifier.weight(1f).padding(start = 8.dp))
                        Text("${group.tagCount}", color = NativeMuted, fontSize = 12.sp)
                        IconButton({ onEdit(group) }) { Icon(Icons.Outlined.Edit, "编辑组") }
                        IconButton({ confirmDelete = group }) {
                            Icon(Icons.Outlined.DeleteOutline, "删除组")
                        }
                    }
                }
                if (groups.isEmpty()) Text("还没有标签组", color = NativeMuted)
            }
        },
        confirmButton = { TextButton(onDismiss) { Text("关闭") } },
    )
    confirmDelete?.let { group ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除标签组？") },
            text = { Text("组内标签会变为未分组，标签和素材都不会删除。") },
            dismissButton = { TextButton({ confirmDelete = null }) { Text("取消") } },
            confirmButton = {
                TextButton({
                    confirmDelete = null
                    onDelete(group)
                }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
        )
    }
}

@Composable
private fun TagGroupEditor(
    group: NativeTagGroupRecord,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (String, String?) -> Unit,
) {
    var name by remember(group.id) { mutableStateOf(group.name) }
    var color by remember(group.id) { mutableStateOf(group.color) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑标签组") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it.take(64) }, label = { Text("名称") })
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = color == null,
                        onClick = { color = null },
                        label = { Text("无") },
                    )
                    tagColors.forEach { value ->
                        FilterChip(
                            selected = color == value,
                            onClick = { color = value },
                            label = {
                                Box(Modifier.size(16.dp).background(tagColor(value), CircleShape))
                            },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton({ onSave(name.trim(), color) }, enabled = name.isNotBlank() && !busy) {
                Text("保存")
            }
        },
        dismissButton = { TextButton(onDismiss) { Text("取消") } },
    )
}

private fun tagColor(value: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(NativeMuted)
