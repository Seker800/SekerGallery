package com.sekereagle.android

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged

private const val PAGE_PREFETCH_ITEMS = 12

@Composable
fun NativeGalleryApp(model: NativeGalleryViewModel, openNative: (String) -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val download by model.downloads.state.collectAsStateWithLifecycle()
    var downloadHidden by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(download) {
        val current = download
        if (current == null || !current.running) downloadHidden = false
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    val notificationPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val uploadPicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            { selected ->
                model.acceptUploadSelection(selected)
                if (
                    selected.isNotEmpty() &&
                        android.os.Build.VERSION.SDK_INT >= 33 &&
                        context.checkSelfPermission(
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
                        !BackupSettings(context).flag("notifications", "requested", false)
                ) {
                    BackupSettings(context).setFlag("notifications", "requested", true)
                    notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }
            },
        )
    NativeTheme {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                BackHandler(
                    state.cacheOpen ||
                        state.transfersOpen ||
                        state.searchOpen ||
                        state.accountOpen ||
                        state.viewerId != null ||
                        state.query.isNotEmpty() ||
                        state.selecting ||
                        state.filters.active ||
                        state.trash ||
                        state.filterPanel != null ||
                        state.tagScreenOpen ||
                        state.busy
                ) {
                    model.back()
                }
                if (state.identity == null) {
                    if (state.restoring) NativeLibraryPlaceholder() else NativeLogin(state, model)
                } else {
                    key(state.identity!!.scope) {
                        val repo = model.repository
                        if (repo != null) {
                            Box(
                                if (state.searchOpen) Modifier.clearAndSetSemantics {} else Modifier
                            ) {
                                NativeLibraryPager(state, model, repo, openNative) {
                                    if (model.prepareUploadSelection())
                                        uploadPicker.launch(arrayOf("*/*"))
                                }
                            }
                            if (state.accountOpen) NativeAccount(state.identity!!, model)
                            if (state.searchOpen) NativeSearch(state, model)
                            if (state.viewerId != null) NativeViewer(state, repo, model)
                            if (state.filterPanel != null) NativeFilterSheet(state, model)
                            if (state.tagScreenOpen) NativeTagScreen(state, model, repo)
                        }
                    }
                }
                if (state.identity != null && download != null && !downloadHidden)
                    NativeDownloadDialog(download!!, model.downloads) { downloadHidden = true }
                if (state.identity != null && download != null && downloadHidden && download!!.running)
                    Surface(
                        Modifier.align(androidx.compose.ui.Alignment.BottomCenter)
                            .padding(bottom = 88.dp)
                            .clickable { downloadHidden = false },
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
                        color = Color(0xEE29292C),
                    ) {
                        Text(
                            "下载中 ${download!!.completed}/${download!!.total} · 查看进度",
                            Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            fontSize = 13.sp,
                        )
                    }
                if (state.identity != null && state.transfersOpen)
                    NativeTransferScreen(state, model, openNative)
                if (state.identity != null && state.cacheOpen)
                    NativeCacheScreen(
                        model.mediaCache,
                        { model.repository?.evictImages() },
                        { model.back() },
                    )
            }
        }
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
internal fun NativeLibraryPage(
    state: GalleryState,
    model: NativeGalleryViewModel,
    repo: NativeGalleryRepository,
    active: Boolean = true,
) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    val grid = rememberLazyGridState()
    val topInset = 70.dp
    val favoriteActive =
        state.query.isBlank() &&
            state.favoriteTagId != null &&
            state.filters.tags == setOf(state.favoriteTagId) &&
            !state.filters.copy(tags = emptySet()).active
    val layout =
        remember(state.items, state.mode, state.trash, state.filters.active, state.query) {
            NativeGridLayout(
                state.items,
                state.mode == GalleryMode.PHOTO,
                (if (state.trash) 1 else 0) +
                    (if (state.filters.active || state.query.isNotEmpty()) 1 else 0),
            )
        }
    var renderedWindow by
        remember(
            state.mode,
            state.sort,
            state.query,
            state.filters,
            state.trash,
            state.scrollRequest,
        ) {
            mutableLongStateOf(state.windowOffset)
        }
    if (state.windowOffset < renderedWindow) {
        val visible = grid.layoutInfo.visibleItemsInfo
        val firstKey = visible.firstOrNull()?.key?.toString().orEmpty()
        // Stable media keys already preserve ordinary scrolling. Only a removed day header needs
        // an explicit photo anchor; leave active gestures alone in every other case.
        if (firstKey.startsWith("date:") && firstKey.removePrefix("date:") !in layout.dayStarts) {
            val anchor = visible.firstOrNull { it.key.toString().startsWith("${state.mode}:") }
            if (anchor != null) {
                val index = anchor.key.toString().removePrefix("${state.mode}:").let(layout::indexOf)
                if (index != null)
                    SideEffect {
                        grid.requestScrollToItem(index, -anchor.offset.y)
                    }
            }
        }
    }
    SideEffect { renderedWindow = state.windowOffset }
    LaunchedEffect(
        active,
        state.windowOffset,
        state.previousCursor,
        state.prefetchPrevious,
        state.loading,
        state.timeline,
        state.error,
    ) {
        if (!active) return@LaunchedEffect
        snapshotFlow {
                grid.firstVisibleItemIndex < PAGE_PREFETCH_ITEMS &&
                    (grid.lastScrolledBackward || state.prefetchPrevious) &&
                    state.windowOffset > 0 &&
                    (state.previousCursor != null || state.timeline != null) &&
                    state.error == null
            }
            .distinctUntilChanged()
            .collect { if (it) model.loadPrevious() }
    }
    var appliedScrollRequest by rememberSaveable { mutableIntStateOf(state.scrollRequest) }
    var confirmEmptyTrash by remember { mutableStateOf(false) }
    LaunchedEffect(state.scrollRequest) {
        // A restored composition already has the correct saved grid position. Only explicit
        // navigation (search, sort, filters, trash, date jump) requests a new starting position.
        if (appliedScrollRequest != state.scrollRequest) {
            grid.scrollToItem(0)
            appliedScrollRequest = state.scrollRequest
        }
    }
    LaunchedEffect(active, grid, state.cursor, state.loading, state.error) {
        if (!active) return@LaunchedEffect
        snapshotFlow {
                val layout = grid.layoutInfo
                (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) to layout.totalItemsCount
            }
            .distinctUntilChanged()
            .collect { (last, total) ->
                if (
                    total > 0 &&
                        last >= 0 &&
                        last >= total - PAGE_PREFETCH_ITEMS &&
                        state.cursor != null &&
                        !state.loading &&
                        state.error == null
                )
                    model.load(true)
            }
    }
    val refreshState = rememberPullToRefreshState()
    Box(
        Modifier.fillMaxSize()
            .pullToRefresh(
                isRefreshing = state.refreshing,
                state = refreshState,
                enabled =
                    active &&
                        !state.loading &&
                        !state.busy &&
                        !state.selecting &&
                        !state.searchOpen &&
                        state.filterPanel == null &&
                        state.viewerId == null,
                onRefresh = model::refresh,
            )
    ) {
        Box(Modifier.fillMaxSize()) {
            LazyVerticalGrid(
                GridCells.Fixed(state.columns),
                state = grid,
                modifier = Modifier.fillMaxSize().testTag("native-grid"),
                contentPadding = PaddingValues(top = topInset, bottom = 104.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (state.trash)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            Modifier.padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("最近删除", Modifier.weight(1f))
                            TextButton(
                                { confirmEmptyTrash = true },
                                enabled = !state.busy && state.items.isNotEmpty(),
                            ) {
                                Text("清空", color = MaterialTheme.colorScheme.error)
                            }
                            TextButton({ model.openTrash(false) }) { Text("返回图库") }
                        }
                    }
                if (state.filters.active || state.query.isNotEmpty())
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            Modifier.fillMaxWidth()
                                .padding(horizontal = 12.dp)
                                .testTag("native-search-results"),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            NativeSearchConditions(
                                state,
                                model,
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                            )
                            TextButton(model::openSearch) { Text("修改条件", fontSize = 13.sp) }
                            IconButton(model::clearSearch) {
                                Icon(Icons.Outlined.Close, "清空搜索", Modifier.size(20.dp))
                            }
                        }
                    }
                state.items.forEach { asset ->
                    if (asset.id in layout.dayStarts)
                        item(key = "date:${asset.id}", span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                asset.groupDate,
                                Modifier.fillMaxWidth()
                                    .then(
                                        if (state.selecting)
                                            Modifier.clickable {
                                                model.selectLoaded(
                                                    state.items
                                                        .filter { it.groupDate == asset.groupDate }
                                                        .map { it.id }
                                                        .toSet()
                                                )
                                            }
                                        else Modifier
                                    )
                                    .padding(
                                        start = 16.dp,
                                        top =
                                            if (state.filters.active || state.query.isNotEmpty())
                                                6.dp
                                            else 18.dp,
                                        bottom =
                                            if (state.filters.active || state.query.isNotEmpty())
                                                6.dp
                                            else 14.dp,
                                    ),
                                fontSize =
                                    if (state.filters.active || state.query.isNotEmpty()) 14.sp
                                    else 17.sp,
                            )
                        }
                    item(key = "${state.mode}:${asset.id}") {
                        Box(
                            Modifier.aspectRatio(1f)
                                .background(Color(0xFF171719))
                                .combinedClickable(
                                    onClick = { model.openAsset(asset.id) },
                                    onLongClick = {
                                        haptics.performHapticFeedback(
                                            androidx.compose.ui.hapticfeedback.HapticFeedbackType
                                                .LongPress
                                        )
                                        model.startSelection(asset.id)
                                    },
                                )
                                .testTag("asset:${asset.id}")
                        ) {
                            NativeImage(
                                repo,
                                asset.thumbnail,
                                false,
                                asset.name,
                                Modifier.fillMaxSize(),
                                ContentScale.Crop,
                                cacheVersion = asset.cacheVersion,
                                active = active,
                            )
                            if (state.selecting) {
                                Icon(
                                    if (asset.id in state.selected) Icons.Outlined.CheckCircle
                                    else Icons.Outlined.RadioButtonUnchecked,
                                    if (asset.id in state.selected) "已选择" else "未选择",
                                    Modifier.align(Alignment.TopEnd)
                                        .padding(7.dp)
                                        .size(24.dp)
                                        .background(Color.Black.copy(alpha = 0.4f), CircleShape),
                                    tint =
                                        if (asset.id in state.selected)
                                            MaterialTheme.colorScheme.primary
                                        else Color.White,
                                )
                            }
                            if (asset.video)
                                Text(
                                    "视频",
                                    Modifier.align(Alignment.BottomStart)
                                        .padding(6.dp)
                                        .background(
                                            Color.Black.copy(alpha = 0.45f),
                                            RoundedCornerShape(6.dp),
                                        )
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                    fontSize = 11.sp,
                                )
                            if (!state.selecting && !state.trash) {
                                if (asset.favorite)
                                    Icon(
                                        Icons.Outlined.Favorite,
                                        "已收藏",
                                        Modifier.align(Alignment.TopEnd)
                                            .padding(6.dp)
                                            .size(20.dp)
                                            .background(
                                                Color.Black.copy(alpha = 0.4f),
                                                CircleShape,
                                            )
                                            .padding(3.dp),
                                        tint = Color(0xFFFF8AA5),
                                    )
                                asset.rating?.let { rating ->
                                    Text(
                                        "★$rating",
                                        Modifier.align(Alignment.TopStart)
                                            .padding(6.dp)
                                            .background(
                                                Color.Black.copy(alpha = 0.45f),
                                                RoundedCornerShape(6.dp),
                                            )
                                            .padding(horizontal = 5.dp, vertical = 2.dp),
                                        fontSize = 11.sp,
                                    )
                                }
                                val version =
                                    when {
                                        asset.edited -> "已编辑"
                                        asset.stackHasEditedMember -> "原片"
                                        else -> null
                                    }
                                version?.let {
                                    Text(
                                        it,
                                        Modifier.align(Alignment.BottomEnd)
                                            .padding(6.dp)
                                            .background(
                                                Color.Black.copy(alpha = 0.55f),
                                                RoundedCornerShape(6.dp),
                                            )
                                            .padding(horizontal = 5.dp, vertical = 2.dp),
                                        fontSize = 10.sp,
                                    )
                                }
                            }
                        }
                    }
                }
                if (
                    state.loading &&
                        !state.refreshing &&
                        !state.loadingPrevious &&
                        state.items.isNotEmpty()
                )
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(
                            Modifier.fillMaxWidth().padding(28.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                Modifier.size(24.dp).testTag("native-next-loading"),
                                strokeWidth = 2.dp,
                            )
                        }
                    }
                if (state.query.isNotBlank() && state.imageSearchStatus == "UNAVAILABLE")
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text("向量搜索暂不可用，当前仅匹配名称和人工标签", color = NativeMuted, modifier = Modifier.padding(16.dp))
                    }
                if (state.error != null)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(
                            Modifier.fillMaxWidth().padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(state.error, color = NativeMuted)
                            TextButton(model::retryRead, enabled = !state.loading) { Text("重试") }
                        }
                    }
            }
            if (state.loading && state.items.isEmpty()) NativeLibraryPlaceholder()
            if (!state.loading && state.items.isEmpty() && state.error == null)
                Column(
                    Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Outlined.PhotoLibrary,
                        null,
                        Modifier.size(34.dp),
                        tint = NativeMuted,
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        if (favoriteActive) "还没有收藏"
                        else if (state.trash) "回收站为空"
                        else if (state.query.isEmpty() && !state.filters.active)
                            "这里还没有${state.mode.title}"
                        else "没有找到符合条件的内容",
                        color = NativeMuted,
                    )
                }
        }
        if (active && state.loadingPrevious && !state.refreshing)
            CircularProgressIndicator(
                Modifier.align(Alignment.TopCenter)
                    // Keep the indicator in the blank band below the floating top bar.
                    .padding(top = topInset + 8.dp)
                    .size(18.dp)
                    .testTag("native-previous-loading"),
                strokeWidth = 2.dp,
                color = NativeMuted,
            )
        PullToRefreshDefaults.Indicator(
            state = refreshState,
            isRefreshing = state.refreshing,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = topInset),
        )
        if (state.timeline != null && !state.searchOpen && !state.selecting)
            NativeFastScroll(
                state,
                grid,
                model::jumpToDay,
                Modifier.align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .padding(top = 90.dp, bottom = 110.dp),
            )
    }
    if (confirmEmptyTrash)
        AlertDialog(
            onDismissRequest = { confirmEmptyTrash = false },
            title = { Text("清空回收站？") },
            text = { Text("将永久删除最近删除中的全部项目，删除后不可恢复。") },
            dismissButton = { TextButton({ confirmEmptyTrash = false }) { Text("取消") } },
            confirmButton = {
                TextButton({
                    confirmEmptyTrash = false
                    model.emptyTrash()
                }) {
                    Text("清空回收站", color = MaterialTheme.colorScheme.error)
                }
            },
        )
}

@Composable
internal fun NativeLibrary(
    state: GalleryState,
    model: NativeGalleryViewModel,
    openNative: (String) -> Unit,
    chooseUpload: () -> Unit,
    content: @Composable () -> Unit,
) {
    val backdrop = rememberGraphicsLayer()
    var sourceOffset by remember { mutableStateOf(Offset.Zero) }
    var menu by rememberSaveable(state.mode) { mutableStateOf<NativeLibraryMenu?>(null) }
    Box(Modifier.fillMaxSize().testTag("native-library")) {
        Box(
            Modifier.fillMaxSize()
                .onGloballyPositioned { sourceOffset = it.positionInRoot() }
                .drawWithContent {
                    backdrop.record { this@drawWithContent.drawContent() }
                    drawLayer(backdrop)
                }
        ) {
            content()
        }
        if (!state.selecting)
            Row(
                Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!state.trash) {
                    val favoriteActive =
                        state.query.isBlank() &&
                            state.favoriteTagId != null &&
                            state.filters.tags == setOf(state.favoriteTagId) &&
                            !state.filters.copy(tags = emptySet()).active
                    GlassSurface(Modifier.size(46.dp), backdrop, sourceOffset) {
                        IconButton({ model.openFavorites() }, Modifier.fillMaxSize()) {
                            Icon(
                                if (favoriteActive) Icons.Outlined.Favorite
                                else Icons.Outlined.FavoriteBorder,
                                "收藏视图",
                                Modifier.size(23.dp),
                                tint =
                                    if (favoriteActive) Color(0xFFFF8AA5) else Color.White,
                            )
                        }
                    }
                }
                GlassSurface(Modifier.size(46.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.Tune, "视图选项") { menu = NativeLibraryMenu.VIEW }
                }
                GlassSurface(Modifier.size(46.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.MoreVert, "更多操作") {
                        menu = NativeLibraryMenu.ACTIONS
                    }
                }
            }
        if (!state.selecting)
            Row(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GlassSurface(Modifier.width(184.dp).height(54.dp), backdrop, sourceOffset) {
                    Row(Modifier.fillMaxSize().padding(3.dp)) {
                        GalleryMode.entries.forEach { mode ->
                            Column(
                                Modifier.weight(1f)
                                    .fillMaxHeight()
                                    .clip(CircleShape)
                                    .background(
                                        if (mode == state.mode) Color.White.copy(alpha = 0.18f)
                                        else Color.Transparent
                                    )
                                    .clickable { model.switchMode(mode) }
                                    .testTag("mode:${mode.name}"),
                                verticalArrangement = Arrangement.Center,
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(
                                    if (mode == GalleryMode.PHOTO) Icons.Outlined.Image
                                    else Icons.Outlined.GridView,
                                    null,
                                    Modifier.size(21.dp),
                                    tint = if (mode == state.mode) Color.White else NativeMuted,
                                )
                                Text(
                                    mode.title,
                                    fontSize = 11.sp,
                                    color = if (mode == state.mode) Color.White else NativeMuted,
                                )
                            }
                        }
                    }
                }
                GlassSurface(Modifier.size(48.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.Search, "搜索", model::openSearch)
                }
            }
        if (state.selecting)
            NativeSelectionControls(state, model, Modifier.fillMaxSize(), backdrop, sourceOffset)
        if (!state.selecting && state.message != null)
            Surface(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 82.dp).clickable {
                    model.dismissMessage()
                },
                shape = RoundedCornerShape(16.dp),
                color = Color(0xEE29292C),
            ) {
                Text(state.message, Modifier.padding(14.dp))
            }
        menu?.let { activeMenu ->
            NativeGalleryMenu(activeMenu, state, model, chooseUpload, openNative) {
                menu = null
            }
        }
    }
}

@Composable
fun RoundAction(icon: ImageVector, label: String, action: () -> Unit) {
    IconButton(action, Modifier.fillMaxSize()) {
        Icon(icon, label, Modifier.size(23.dp), tint = Color.White)
    }
}

@Composable
fun MenuRow(text: String, icon: ImageVector, action: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = action)
            .padding(horizontal = 20.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, Modifier.size(22.dp), tint = Color.White)
        Text(text, fontSize = 16.sp)
    }
}
