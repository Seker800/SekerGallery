package com.sekereagle.android

import com.sekereagle.android.core.NativeCacheStatistics

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.IOException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject

enum class GalleryMode(val title: String) {
    PHOTO("照片"),
    MATERIAL("素材"),
}

data class NativeAsset(
    val id: String,
    val name: String,
    val date: String,
    val time: String,
    val width: Int,
    val height: Int,
    val thumbnail: String?,
    val preview: String?,
    val video: Boolean,
    val revision: Int,
    val rowVersion: Int = 1,
    val groupDate: String = date,
    val playback: String? = null,
    val playbackSize: Long = 0,
    val city: String? = null,
    val cacheVersion: String? = null,
    val favorite: Boolean = false,
    val mimeType: String = "",
    val lifecycleStatus: String = "",
    val rating: Int? = null,
    val tags: List<NativeAssetTag> = emptyList(),
    val edited: Boolean = false,
    val stackId: String? = null,
    val stackAssetIds: List<String> = emptyList(),
    val stackBestAssetId: String? = null,
    val stackCoverId: String? = null,
    val stackHasEditedMember: Boolean = false,
)

data class NativeAssetTag(val id: String, val name: String, val color: String? = null)

data class NativeTagRecord(
    val id: String,
    val name: String,
    val color: String? = null,
    val groupId: String? = null,
    val groupIds: List<String> = emptyList(),
    val isStarred: Boolean = false,
    val assetCount: Int = 0,
    val rowVersion: Int = 1,
    val privateRule: Boolean = false,
    val pinyin: String = "",
    val pinyinInitials: String = "",
) {
    val system: Boolean
        get() = name == "收藏" || name == "已编辑"
}

data class NativeTagGroupRecord(
    val id: String,
    val name: String,
    val color: String? = null,
    val description: String? = null,
    val rowVersion: Int = 1,
    val tagCount: Int = 0,
)

data class NativeStack(
    val id: String,
    val assetIds: List<String>,
    val bestAssetId: String,
    val coverId: String,
    val hasEditedMember: Boolean,
    val cover: NativeAsset? = null,
)

data class NativeDay(val date: String, val before: String, val count: Long, val offset: Long) {
    val label: String
        get() = java.time.LocalDate.parse(date).format(DateTimeFormatter.ofPattern("yyyy年M月d日"))
}

data class NativeTimeline(val days: List<NativeDay>, val total: Long) {
    fun dayAt(position: Long): NativeDay? {
        if (days.isEmpty()) return null
        var low = 0
        var high = days.size
        while (low < high) {
            val middle = low + (high - low) / 2
            if (days[middle].offset <= position) low = middle + 1 else high = middle
        }
        return days[(low - 1).coerceAtLeast(0)]
    }
}

data class NativePage(
    val items: List<NativeAsset>,
    val cursor: String?,
    val imageSearchStatus: String? = null,
    val stacks: List<NativeStack> = emptyList(),
)

/**
 * Older servers only expose extensions. Map the aliases whose stored inspection format differs, so
 * the list format filter still matches rather than silently returning an empty page.
 */
internal fun canonicalFormat(extension: String): String =
    when (val value = extension.lowercase(java.util.Locale.ROOT).removePrefix(".")) {
        "jpg" -> "jpeg"
        "heic" -> "heif"
        "tif" -> "tiff"
        "m4v" -> "mp4"
        "m2ts" -> "mts"
        "mpeg" -> "mpg"
        else -> value
    }

/** One scoped implementation for both modes; only authenticated derived media enters the cache. */
class NativeGalleryRepository(
    private val session: NativeSession,
    private val scope: String,
    private val disk: NativeMediaCache? = null,
) {
    internal val editorHost
        get() =
            "e" +
                java.security.MessageDigest.getInstance("SHA-256")
                    .digest(scope.toByteArray())
                    .joinToString("") { "%02x".format(it) } +
                ".editor.sekereagle.invalid"

    internal val connection
        get() = session

    private val imagesLock = Any()
    private val catalogLock = Any()
    private val optionCache =
        mutableMapOf<Pair<GalleryMode, NativeOptionSection>, Pair<Long, NativeOptions>>()
    private val favoriteTagCache = mutableMapOf<GalleryMode, Pair<Long, String?>>()
    private val favoritePrivacyCache = mutableMapOf<GalleryMode, Pair<Long, Boolean>>()
    private var memoryEpoch = 0
    private val imageVersions = LruCache<String, String>(4096)
    private val imageLoads = Array(32) { Mutex() }
    private val decoding = Semaphore(4)
    private val cache =
        object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
        }

    suspend fun page(
        mode: GalleryMode,
        search: String,
        cursor: String? = null,
        filters: NativeFilters = NativeFilters(),
        trash: Boolean = false,
        sort: GallerySort = GallerySort.default(mode),
        before: String? = null,
        offset: Long = 0,
        cancellation: NativeTransferCancellation? = null,
        relevance: Boolean = false,
    ): NativePage =
        withContext(Dispatchers.IO) {
            val result =
                session.json(
                    "GET",
                    NativeGalleryPolicy.listPath(mode.name, search, cursor.orEmpty()).let {
                        if (trash) it.replace("/assets?", "/trash?") else it
                    } +
                        (if (relevance) "" else "&sort=${sort.name}") +
                        (if (
                            relevance &&
                                search.isBlank() &&
                                filters.smartFolderId.isNotBlank()
                        )
                            "&smartFolderOrder=RELEVANCE"
                        else "") +
                        (before?.let { "&before=" + java.net.URLEncoder.encode(it, "UTF-8") }
                            ?: "") +
                        (if (offset > 0) "&offset=$offset" else "") +
                        filters.parameters().querySuffix(),
                    cancellation = cancellation,
                )
            val items = result.getJSONArray("items")
            val parsed =
                (0 until items.length()).map { parse(items.getJSONObject(it), mode, sort) }
            val stacks =
                result.optJSONArray("photoStacks")?.let { rows ->
                    (0 until rows.length()).mapNotNull { index ->
                        val row = rows.getJSONObject(index)
                        val coverJson = row.optJSONObject("cover")
                        val cover = coverJson?.let { parse(it, mode, sort) }
                        val assetIds =
                            row.optJSONArray("assetIds")?.let { values ->
                                (0 until values.length()).map { values.getString(it) }
                            } ?: emptyList()
                        val best = row.optString("bestAssetId").takeIf {
                            it.isNotBlank() && it != "null"
                        }
                        if (assetIds.size < 2 || best == null) null
                        else
                            NativeStack(
                                row.getString("id"),
                                assetIds,
                                best,
                                coverJson?.optString("id")?.takeIf {
                                    it.isNotBlank() && it != "null"
                                } ?: best,
                                row.optBoolean("hasEditedMember", false),
                                cover,
                            )
                    }
                } ?: emptyList()
            val stackByAsset = mutableMapOf<String, NativeStack>()
            for (stack in stacks) for (assetId in stack.assetIds) stackByAsset[assetId] = stack
            NativePage(
                parsed.map { asset ->
                    val stack = stackByAsset[asset.id]
                    if (stack == null) asset
                    else
                        asset.copy(
                            stackId = stack.id,
                            stackAssetIds = stack.assetIds,
                            stackBestAssetId = stack.bestAssetId,
                            stackCoverId = stack.coverId,
                            stackHasEditedMember = stack.hasEditedMember,
                        )
                },
                result.optString("nextCursor").takeUnless { it.isEmpty() || it == "null" },
                result.optJSONObject("imageSearch")?.optString("status")?.takeIf {
                    search.isNotBlank() && it in setOf("READY", "UNAVAILABLE")
                },
                stacks,
            )
        }

    suspend fun detail(
        mode: GalleryMode,
        id: String,
        sort: GallerySort = GallerySort.default(mode),
    ): NativeAsset = withContext(Dispatchers.IO) {
        val base = NativeGalleryPolicy.base(mode.name)
        val assetId = NativeGalleryPolicy.identifier(id)
        parse(session.json("GET", "$base/assets/$assetId"), mode, sort)
    }

    suspend fun timeline(
        mode: GalleryMode,
        sort: GallerySort,
        cancellation: NativeTransferCancellation? = null,
    ): NativeTimeline =
        withContext(Dispatchers.IO) {
            val zone = java.net.URLEncoder.encode(ZoneId.systemDefault().id, "UTF-8")
            val json =
                session.json(
                    "GET",
                    "${NativeGalleryPolicy.base(mode.name)}/assets/timeline?sort=${sort.name}&timeZone=$zone",
                    cancellation = cancellation,
                )
            val days = json.getJSONArray("days")
            NativeTimeline(
                (0 until days.length()).map {
                    days.getJSONObject(it).let { day ->
                        NativeDay(
                            day.getString("date"),
                            day.getString("before"),
                            day.getLong("count"),
                            day.getLong("offset"),
                        )
                    }
                },
                json.getLong("total"),
            )
        }

    internal fun videoPlayback(asset: NativeAsset): NativeVideoPlayback {
        require(asset.video && asset.playback != null && asset.playbackSize > 0)
        val uri = android.net.Uri.parse(session.origin + asset.playback)
        return NativeVideoPlayback(
            uri,
            NativeVideoDataSourceFactory(session, asset.playback, asset.playbackSize, uri),
        )
    }

    suspend fun options(
        mode: GalleryMode,
        section: NativeOptionSection,
        cancellation: NativeTransferCancellation? = null,
    ): NativeOptions =
        withContext(Dispatchers.IO) {
            val cacheKey = mode to section
            synchronized(catalogLock) {
                    optionCache[cacheKey]
                        ?.takeIf { System.currentTimeMillis() - it.first < CATALOG_TTL_MS }
                }
                ?.let { return@withContext it.second }
            val base = NativeGalleryPolicy.base(mode.name)
            fun strings(json: JSONObject, key: String): List<String> =
                json
                    .optJSONArray(key)
                    ?.let { a -> (0 until a.length()).map { a.getString(it) } }
                    .orEmpty()
                    .filter { it.isNotBlank() }
                    .distinct()
            val result =
                when (section) {
                NativeOptionSection.TAGS -> {
                    // Legacy catalogs include counts and groups for every tag. Keep this larger
                    // read budget local to catalogs; ordinary JSON and media budgets are unchanged.
                    val rows = session.array("$base/manual-tags", 16 * 1024 * 1024, cancellation)
                    NativeOptions(
                        tags =
                            (0 until rows.length())
                                .map { i ->
                                    cancellation?.check()
                                    val row = rows.getJSONObject(i)
                                    val name = row.getString("name")
                                    NativeTag(
                                        row.getString("id"),
                                        name,
                                        normalizeTagSearch(
                                            "$name ${row.optString("pinyin")} ${row.optString("pinyinInitials")}"
                                        ),
                                    )
                                }
                                .distinctBy { it.id }
                    )
                }
                NativeOptionSection.SMART_FOLDERS -> {
                    val rows = session.array("$base/smart-folders", 16 * 1024 * 1024, cancellation)
                    NativeOptions(
                        folders =
                            nativeFolderChoices(
                                (0 until rows.length()).map { i ->
                                    cancellation?.check()
                                    val row = rows.getJSONObject(i)
                                    NativeFolder(
                                        row.getString("id"),
                                        row.getString("name"),
                                        row.optString("parentId").takeUnless {
                                            it.isBlank() || it == "null"
                                        },
                                    )
                                }
                            )
                    )
                }
                NativeOptionSection.FORMATS -> {
                    val json =
                        session.json("GET", "$base/media-capabilities", cancellation = cancellation)
                    fun formats(part: JSONObject) =
                        strings(part, "formats")
                            .ifEmpty { strings(part, "extensions") }
                            .map(::canonicalFormat)
                    NativeOptions(
                        formats =
                            (formats(json.getJSONObject("images")) +
                                    formats(json.getJSONObject("videos")))
                                .distinct()
                                .sorted()
                    )
                }
                NativeOptionSection.PHOTOGRAPHY -> {
                    if (mode != GalleryMode.PHOTO) NativeOptions()
                    else
                        session
                            .json("GET", "$base/photography/facets", cancellation = cancellation)
                            .let {
                                NativeOptions(
                                    cameras = strings(it, "cameras"),
                                    lenses = strings(it, "lenses"),
                                )
                            }
                }
            }
            synchronized(catalogLock) {
                optionCache[cacheKey] = System.currentTimeMillis() to result
            }
            result
        }

    /** Favorites are ordinary mode-scoped manual tags; the server remains the source of truth. */
    suspend fun setFavorite(mode: GalleryMode, id: String, enabled: Boolean): String? =
        setFavoriteAssets(mode, setOf(id), enabled)

    /** Batch favorite uses the same mode-scoped manual tag as the web workspace. */
    suspend fun setFavoriteAssets(
        mode: GalleryMode,
        ids: Set<String>,
        enabled: Boolean,
    ): String? =
        withContext(Dispatchers.IO) {
            require(ids.isNotEmpty())
            val tagId = ensureFavoriteTag(mode, enabled) ?: return@withContext null
            val base = NativeGalleryPolicy.base(mode.name)
            require(!isPrivateTag(mode, tagId)) { "收藏标签被设为私密，请先在设置中调整。" }
            session
                .json(
                    "POST",
                    "$base/assets/batch/manual-tags",
                    JSONObject()
                        .put(
                            "assetIds",
                            org.json.JSONArray(ids.map { NativeGalleryPolicy.identifier(it) }),
                        )
                        .put(
                            "addTagIds",
                            org.json.JSONArray(if (enabled) listOf(tagId) else emptyList<String>()),
                        )
                        .put(
                            "removeTagIds",
                            org.json.JSONArray(if (enabled) emptyList<String>() else listOf(tagId)),
                        ),
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun favoriteTagId(mode: GalleryMode): String? =
        withContext(Dispatchers.IO) { ensureFavoriteTag(mode, false) }

    private suspend fun ensureFavoriteTag(mode: GalleryMode, create: Boolean): String? {
        val base = NativeGalleryPolicy.base(mode.name)
        fun fetchTag(): String? {
            val tags = session.array("$base/manual-tags", 16 * 1024 * 1024)
            return (0 until tags.length())
                .asSequence()
                .map { tags.getJSONObject(it) }
                .firstOrNull { it.getString("name") == "收藏" }
                ?.getString("id")
        }
        val now = System.currentTimeMillis()
        val cachedTag = synchronized(catalogLock) { favoriteTagCache[mode] }
        var tagId =
            if (cachedTag != null && now - cachedTag.first < CATALOG_TTL_MS) cachedTag.second
            else
                fetchTag().also {
                    synchronized(catalogLock) { favoriteTagCache[mode] = now to it }
                }
        if (create && tagId == null) {
            tagId =
                try {
                    session
                        .json("POST", "$base/manual-tags", JSONObject().put("name", "收藏"))
                        .getString("id")
                } catch (reason: NativeSession.Failure) {
                    if (reason.status != 409) throw reason
                    fetchTag() ?: throw reason
                }
            synchronized(catalogLock) {
                favoriteTagCache[mode] = System.currentTimeMillis() to tagId
                optionCache.remove(mode to NativeOptionSection.TAGS)
            }
        }
        return tagId
    }

    private suspend fun isPrivateTag(mode: GalleryMode, tagId: String): Boolean {
        val now = System.currentTimeMillis()
        val cached = synchronized(catalogLock) { favoritePrivacyCache[mode] }
        if (cached != null && now - cached.first < CATALOG_TTL_MS) return cached.second
        val privacy =
            session
                .json("GET", "${NativeGalleryPolicy.base(mode.name)}/privacy-settings")
                .getJSONArray("tagIds")
        val value = (0 until privacy.length()).any { privacy.getString(it) == tagId }
        synchronized(catalogLock) { favoritePrivacyCache[mode] = now to value }
        return value
    }

    suspend fun change(
        mode: GalleryMode,
        assets: List<NativeAsset>,
        action: String,
        tagIds: Set<String> = emptySet(),
        rating: Int? = null,
    ): String? =
        withContext(Dispatchers.IO) {
            require(assets.isNotEmpty())
            val base = NativeGalleryPolicy.base(mode.name)
            val ids = org.json.JSONArray(assets.map { NativeGalleryPolicy.identifier(it.id) })
            when (action) {
                "trash",
                "restore" ->
                    assetOperations
                        .enqueue(
                            mode,
                            if (action == "trash") "TRASH" else "RESTORE",
                            assets.map { it.id }.toSet(),
                        )
                        .id
                "tags",
                "removeTags" ->
                    session
                        .json(
                            "POST",
                            "$base/assets/batch/manual-tags",
                            JSONObject()
                                .put("assetIds", ids)
                                .put(
                                    "addTagIds",
                                    org.json.JSONArray(
                                        if (action == "tags") tagIds.toList()
                                        else emptyList<String>()
                                    ),
                                )
                                .put(
                                    "removeTagIds",
                                    org.json.JSONArray(
                                        if (action == "removeTags") tagIds.toList()
                                        else emptyList<String>()
                                    ),
                                ),
                        )
                        .optString("id")
                        .takeUnless { it.isBlank() || it == "null" }
                "rating" ->
                    session
                        .json(
                            "PATCH",
                            "$base/assets/batch",
                            JSONObject()
                                .put(
                                    "assets",
                                    org.json.JSONArray(
                                        assets.map {
                                            JSONObject()
                                                .put("assetId", it.id)
                                                .put("rowVersion", it.rowVersion)
                                        }
                                    ),
                                )
                                .put("rating", rating ?: JSONObject.NULL),
                        )
                        .optString("id")
                        .takeUnless { it.isBlank() || it == "null" }
                else -> error("未知操作")
            }.also {
                synchronized(catalogLock) {
                    optionCache.keys.removeAll { it.first == mode }
                    favoriteTagCache.remove(mode)
                    favoritePrivacyCache.remove(mode)
                }
            }
        }

    suspend fun listTags(mode: GalleryMode): List<NativeTagRecord> =
        withContext(Dispatchers.IO) {
            val base = NativeGalleryPolicy.base(mode.name)
            val rows = session.array("$base/manual-tags", 16 * 1024 * 1024)
            val privacy = privacyTagIds(mode)
            (0 until rows.length()).mapNotNull { index ->
                runCatching { parseTag(rows.getJSONObject(index), privacy) }.getOrNull()
            }
        }

    suspend fun listTagGroups(mode: GalleryMode): List<NativeTagGroupRecord> =
        withContext(Dispatchers.IO) {
            val rows =
                session.array("${NativeGalleryPolicy.base(mode.name)}/manual-tag-groups", 4 * 1024 * 1024)
            (0 until rows.length()).mapNotNull { index ->
                runCatching {
                        rows.getJSONObject(index).let { row ->
                            NativeTagGroupRecord(
                                row.getString("id"),
                                row.getString("name"),
                                row.optString("color").takeUnless { it == "null" },
                                row.optString("description").takeUnless { it == "null" },
                                row.optInt("rowVersion", 1),
                                row.optInt("tagCount", 0),
                            )
                        }
                    }
                    .getOrNull()
            }
        }

    suspend fun createTag(mode: GalleryMode, name: String, color: String? = null): NativeTagRecord =
        withContext(Dispatchers.IO) {
            val row =
                session.json(
                    "POST",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tags",
                    JSONObject().put("name", name).apply {
                        if (color != null) put("color", color)
                    },
                )
            parseTag(row, emptySet())
        }

    suspend fun updateTag(
        mode: GalleryMode,
        tag: NativeTagRecord,
        name: String? = null,
        color: String? = null,
        groupId: String? = null,
        isStarred: Boolean? = null,
    ): String? =
        withContext(Dispatchers.IO) {
            val body =
                JSONObject().put("rowVersion", tag.rowVersion).apply {
                    name?.let { put("name", it) }
                    put("color", color ?: JSONObject.NULL)
                    put("groupId", groupId ?: JSONObject.NULL)
                    isStarred?.let { put("isStarred", it) }
                }
            session
                .json(
                    "PATCH",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tags/${NativeGalleryPolicy.identifier(tag.id)}",
                    body,
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun deleteTag(mode: GalleryMode, tag: NativeTagRecord): String? =
        withContext(Dispatchers.IO) {
            session
                .json(
                    "DELETE",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tags/${NativeGalleryPolicy.identifier(tag.id)}",
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun createTagGroup(
        mode: GalleryMode,
        name: String,
        color: String? = null,
    ): NativeTagGroupRecord =
        withContext(Dispatchers.IO) {
            val row =
                session.json(
                    "POST",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tag-groups",
                    JSONObject().put("name", name).apply {
                        if (color != null) put("color", color)
                    },
                )
            parseTagGroup(row)
        }

    suspend fun updateTagGroup(
        mode: GalleryMode,
        group: NativeTagGroupRecord,
        name: String? = null,
        color: String? = null,
        description: String? = null,
    ): NativeTagGroupRecord =
        withContext(Dispatchers.IO) {
            val body =
                JSONObject().put("rowVersion", group.rowVersion).apply {
                    name?.let { put("name", it) }
                    put("color", color ?: JSONObject.NULL)
                    description?.let { put("description", it) }
                }
            parseTagGroup(
                session.json(
                    "PATCH",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tag-groups/${NativeGalleryPolicy.identifier(group.id)}",
                    body,
                )
            )
        }

    suspend fun deleteTagGroup(mode: GalleryMode, group: NativeTagGroupRecord): String? =
        withContext(Dispatchers.IO) {
            session
                .json(
                    "DELETE",
                    "${NativeGalleryPolicy.base(mode.name)}/manual-tag-groups/${NativeGalleryPolicy.identifier(group.id)}",
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun setRating(
        mode: GalleryMode,
        assetId: String,
        rowVersion: Int,
        rating: Int?,
    ): String? =
        withContext(Dispatchers.IO) {
            session
                .json(
                    "PATCH",
                    "${NativeGalleryPolicy.base(mode.name)}/assets/${NativeGalleryPolicy.identifier(assetId)}",
                    JSONObject()
                        .put("rowVersion", rowVersion)
                        .put("rating", rating ?: JSONObject.NULL),
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun emptyTrash(mode: GalleryMode): String? =
        withContext(Dispatchers.IO) {
            session
                .json("POST", "${NativeGalleryPolicy.base(mode.name)}/trash/empty", JSONObject())
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    suspend fun setStackBest(mode: GalleryMode, groupId: String, assetId: String): String? =
        withContext(Dispatchers.IO) {
            require(mode == GalleryMode.PHOTO)
            session
                .json(
                    "PATCH",
                    "${NativeGalleryPolicy.base(mode.name)}/photography/groups/${NativeGalleryPolicy.identifier(groupId)}",
                    JSONObject().put("bestAssetId", NativeGalleryPolicy.identifier(assetId)),
                )
                .optString("id")
                .takeUnless { it.isBlank() || it == "null" }
        }

    private suspend fun privacyTagIds(mode: GalleryMode): Set<String> {
        val rows =
            session
                .json("GET", "${NativeGalleryPolicy.base(mode.name)}/privacy-settings")
                .getJSONArray("tagIds")
        return (0 until rows.length()).map { rows.getString(it) }.toSet()
    }

    private fun parseTag(row: JSONObject, privacy: Set<String>): NativeTagRecord {
        val groupIds =
            row.optJSONArray("groupIds")?.let { values ->
                (0 until values.length()).map { values.getString(it) }
            } ?: emptyList()
        return NativeTagRecord(
            row.getString("id"),
            row.getString("name"),
            row.optString("color").takeUnless { it.isBlank() || it == "null" },
            row.optString("groupId").takeUnless { it.isBlank() || it == "null" },
            groupIds,
            row.optBoolean("isStarred", false),
            row.optInt("assetCount", 0),
            row.optInt("rowVersion", 1),
            privacy.contains(row.optString("id")),
            row.optString("pinyin"),
            row.optString("pinyinInitials"),
        )
    }

    private fun parseTagGroup(row: JSONObject) =
        NativeTagGroupRecord(
            row.getString("id"),
            row.getString("name"),
            row.optString("color").takeUnless { it.isBlank() || it == "null" },
            row.optString("description").takeUnless { it.isBlank() || it == "null" },
            row.optInt("rowVersion", 1),
            row.optInt("tagCount", 0),
        )

    internal val assetOperations = NativeAssetOperations(session)

    internal fun imageVersion(path: String?): String? = path?.let { imageVersions.get(it) }

    suspend fun image(
        path: String,
        full: Boolean,
        sourceVersion: String? = imageVersion(path),
        cancellation: NativeTransferCancellation? = null,
    ): Bitmap =
        withContext(Dispatchers.IO) {
            val epoch = session.authorizationEpoch()
            val local = synchronized(imagesLock) { memoryEpoch }
            val ticket = disk?.generation ?: 0
            val statisticsTicket = disk?.statisticsTicket() ?: 0
            val version = sourceVersion
            val key = "$scope:$full:$path:$version:$ticket"
            val id = version?.let { disk?.identity(scope, path, it) }
            fun record(outcome: NativeCacheStatistics.Outcome) {
                if (id != null) disk?.record(outcome, statisticsTicket)
            }
            fun checkActive() {
                session.checkAuthorization(epoch)
                synchronized(imagesLock) {
                    if (memoryEpoch != local) throw kotlinx.coroutines.CancellationException()
                }
            }
            checkActive()
            cache.get(key)?.let {
                checkActive()
                id?.let { entry -> disk?.touch(entry) }
                checkActive()
                record(NativeCacheStatistics.Outcome.MEMORY)
                return@withContext it
            }
            imageLoads[(path.hashCode() and Int.MAX_VALUE) % imageLoads.size].withLock {
                decoding.withPermit {
                    checkActive()
                    cache.get(key)?.let {
                        checkActive()
                        record(NativeCacheStatistics.Outcome.MEMORY)
                        return@withPermit it
                    }
                    val cached = id?.let { disk?.read(it) }
                    fun decode(bytes: ByteArray): Bitmap {
                        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                        if (
                            options.outWidth <= 0 ||
                                options.outHeight <= 0 ||
                                options.outWidth.toLong() * options.outHeight > 100_000_000L
                        )
                            throw IOException("预览尺寸不可用")
                        val edge = if (full) 2048 else 384
                        options.inSampleSize = 1
                        while (
                            maxOf(options.outWidth, options.outHeight) / options.inSampleSize > edge
                        ) options.inSampleSize *= 2
                        options.inJustDecodeBounds = false
                        options.inPreferredConfig = Bitmap.Config.ARGB_8888
                        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                            ?: throw IOException("预览解码失败")
                    }
                    var bitmap =
                        cached?.let {
                            try {
                                decode(it)
                            } catch (_: Exception) {
                                null
                            }
                        }
                    val diskHit = bitmap != null
                    if (bitmap == null) {
                        if (id != null && cached != null) disk?.remove(id)
                        val bytes = session.media(path, cancellation)
                        checkActive()
                        bitmap = decode(bytes)
                        if (id != null) disk?.write(id, bytes, ticket)
                    }
                    checkActive()
                    val result = bitmap
                    synchronized(imagesLock) {
                        checkActive()
                        if (disk == null || ticket == disk.generation) cache.put(key, result)
                    }
                    record(if (diskHit) NativeCacheStatistics.Outcome.DISK else NativeCacheStatistics.Outcome.DOWNLOAD)
                    result
                }
            }
        }

    internal fun evictImages() = synchronized(imagesLock) { cache.evictAll() }

    fun clear() =
        synchronized(imagesLock) {
            memoryEpoch++
            cache.evictAll()
            imageVersions.evictAll()
        }.also {
            synchronized(catalogLock) {
                optionCache.clear()
                favoriteTagCache.clear()
                favoritePrivacyCache.clear()
            }
        }

    internal fun invalidateOptions(mode: GalleryMode? = null) {
        synchronized(catalogLock) {
            if (mode == null) optionCache.clear()
            else optionCache.keys.removeAll { it.first == mode }
        }
    }

    internal fun invalidateFavorite(mode: GalleryMode) {
        synchronized(catalogLock) {
            favoriteTagCache.remove(mode)
            favoritePrivacyCache.remove(mode)
        }
    }

    internal fun parse(
        json: JSONObject,
        mode: GalleryMode,
        sort: GallerySort = GallerySort.default(mode),
    ): NativeAsset {
        val id = NativeGalleryPolicy.identifier(json.getString("id"))
        val renditions = json.getJSONArray("renditions")
        val images =
            (0 until renditions.length())
                .map { renditions.getJSONObject(it) }
                .filter {
                    it.optInt("revision") == json.optInt("mediaRevision") &&
                        it.optString("mimeType").startsWith("image/") &&
                        it.optString("variant") != "edit"
                }
        val stamp =
            if (!json.optBoolean("isPrivate") && json.isNull("deletedAt"))
                com.sekereagle.android.core.BackupPolicy.digest(
                    "${json.optInt("mediaRevision")}:${json.optString("updatedAt")}:" +
                        images
                            .sortedBy { it.getString("id") }
                            .joinToString(";") { row ->
                                listOf(
                                        row.getString("id"),
                                        row.optInt("revision"),
                                        row.optString("mimeType"),
                                        row.optLong("byteSize"),
                                        row.optInt("width"),
                                        row.optInt("height"),
                                    )
                                    .joinToString(":")
                            }
                )
            else null
        for (row in images) {
            val mediaPath = NativeGalleryPolicy.mediaPath(mode.name, id, row.getString("id"))
            if (stamp != null) imageVersions.put(mediaPath, stamp)
            else imageVersions.remove(mediaPath)
        }
        fun path(kind: String): String? =
            images
                .firstOrNull { it.optString("kind") == kind }
                ?.let { NativeGalleryPolicy.mediaPath(mode.name, id, it.getString("id")) }
        val movie =
            (0 until renditions.length())
                .map { renditions.getJSONObject(it) }
                .firstOrNull {
                    it.optInt("revision") == json.optInt("mediaRevision") &&
                        it.optString("kind") == "PREVIEW" &&
                        it.optString("mimeType") == "video/mp4" &&
                        it.optLong("byteSize") > 0
                }
        val rawDate =
            json.optJSONObject("photoMetadata")?.let {
                it.optString("capturedLocal").takeUnless { v -> v.isEmpty() || v == "null" }
            }
                ?: json.optString("chronologicalAt").takeUnless { it.isEmpty() || it == "null" }
                ?: json.optString("libraryAddedAt")
        fun localDate(value: String) =
            runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime() }
                .getOrElse { runCatching { LocalDateTime.parse(value) }.getOrNull() }
        val date = localDate(rawDate)
        val groupDate =
            localDate(
                json.optString(
                    if (sort == GallerySort.ADDED_AT) "libraryAddedAt" else "chronologicalAt"
                )
            ) ?: date
        val tags =
            json.optJSONArray("manualTags")?.let { rows ->
                (0 until rows.length()).mapNotNull { index ->
                    val row = rows.getJSONObject(index)
                    val tagId = row.optString("id").takeIf { it.isNotBlank() && it != "null" }
                    val name = row.optString("name").takeIf { it.isNotBlank() && it != "null" }
                    if (tagId == null || name == null) null
                    else NativeAssetTag(tagId, name, row.optString("color").takeUnless { it == "null" })
                }
            } ?: emptyList()
        return NativeAsset(
            id,
            json.optString("displayName", json.optString("originalName")),
            date?.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) ?: "日期未知",
            date?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: "",
            json.optInt("width", 1),
            json.optInt("height", 1),
            path("THUMBNAIL") ?: path("POSTER") ?: path("PREVIEW"),
            path("PREVIEW") ?: path("POSTER") ?: path("THUMBNAIL"),
            json.optString("mimeType").startsWith("video/"),
            json.optInt("mediaRevision"),
            json.optInt("rowVersion", 1),
            groupDate?.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) ?: "日期未知",
            movie?.let { NativeGalleryPolicy.mediaPath(mode.name, id, it.getString("id")) },
            movie?.optLong("byteSize") ?: 0,
            NativeCity.label(json),
            stamp,
            tags.any { it.name == "收藏" },
            json.optString("mimeType"),
            json.optString("lifecycleStatus"),
            json.optInt("rating", 0).takeIf { it > 0 },
            tags,
            json.optJSONObject("photoMetadata")?.optBoolean("captureMetadataInherited") == true,
        )
    }

    private companion object {
        const val CATALOG_TTL_MS = 60_000L
    }
}
