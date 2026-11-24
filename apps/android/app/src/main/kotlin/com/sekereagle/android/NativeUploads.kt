package com.sekereagle.android

import android.content.Context
import android.net.Uri
import com.sekereagle.android.core.BackupEngine
import com.sekereagle.android.core.ContentCheckBatcher
import com.sekereagle.android.core.NativeUploadPolicy
import com.sekereagle.android.core.UploadBudget
import java.io.IOException
import java.util.Collections
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject

internal enum class NativeUploadPhase {
    PREPARING,
    READY,
    RUNNING,
    FINISHED,
}

internal data class NativeUploadEntry(
    val uri: Uri,
    val name: String,
    val size: Long = 0,
    val error: String? = null,
)

internal data class NativeUploadIssue(val entry: NativeUploadEntry, val reason: String)

internal data class NativeUploadItemProgress(
    val stage: String = "",
    val bytes: Long = 0,
    val size: Long = 0,
    val active: Boolean = false,
    val verifying: Boolean = false,
)

internal data class NativeUploadState(
    val mode: GalleryMode,
    val phase: NativeUploadPhase,
    val entries: List<NativeUploadEntry>,
    val uploaded: Int = 0,
    val skipped: Int = 0,
    val issues: List<NativeUploadIssue> = emptyList(),
    val remaining: List<NativeUploadEntry> = emptyList(),
    val current: String = "",
    val stage: String = "",
    val bytes: Long = 0,
    val size: Long = 0,
    val cancelled: Boolean = false,
    val completedEntries: Set<Uri> = emptySet(),
    val items: Map<String, NativeUploadItemProgress> = emptyMap(),
)

/** Pause/halt may arrive while the prepare job is still reading metadata. */
internal fun uploadMayStart(phase: NativeUploadPhase, cancelled: Boolean): Boolean =
    phase == NativeUploadPhase.READY && !cancelled

/** A selected-file queue reuses the backup engine, without enabling or editing automatic backup. */
class NativeUploads(
    context: Context,
    private val scope: CoroutineScope,
    private val unauthorized: (NativeSession) -> Unit,
    private val completed: (String, GalleryMode) -> Unit,
    private val journalStore: NativeUploadPolicy.ManualStore? = null,
) {
    private val app = context.applicationContext
    private val generation = AtomicInteger()
    private val mutable = MutableStateFlow<NativeUploadState?>(null)
    internal val state = mutable.asStateFlow()
    private var session: NativeSession? = null
    private var identity = ""
    private var sessionEpoch = 0
    private var journal: NativeUploadPolicy.ManualStore =
        journalStore ?: NativeUploadPolicy.Journal()
    private var cancelled = AtomicBoolean()
    private var paused = AtomicBoolean()
    private var requestCancellation = NativeTransferCancellation()
    private var job: Job? = null

    fun prepare(session: NativeSession, identity: String, mode: GalleryMode, uris: List<Uri>) {
        clear()
        cancelled = AtomicBoolean()
        paused = AtomicBoolean()
        try {
            sessionEpoch = session.authorizationEpoch()
        } catch (_: NativeSession.Failure) {
            unauthorized(session)
            return
        }
        this.session = session
        this.identity = identity
        journal = journalStore ?: NativeUploadPolicy.Journal()
        val ticket = generation.get()
        val guard = cancelled
        val selected =
            try {
                NativeUploadPolicy.picked(uris.map { it.toString() }).map(Uri::parse)
            } catch (reason: IllegalArgumentException) {
                mutable.value =
                    NativeUploadState(
                        mode,
                        NativeUploadPhase.FINISHED,
                        emptyList(),
                        current = reason.message.orEmpty(),
                    )
                return
            }
        if (selected.isEmpty()) {
            publish(
                generation.get(),
                NativeUploadState(mode, NativeUploadPhase.FINISHED, emptyList()),
            )
            return
        }
        mutable.value = NativeUploadState(mode, NativeUploadPhase.PREPARING, emptyList())
        job =
            scope.launch(Dispatchers.IO) {
                try {
                    val catalog = MediaCatalog(app)
                    val entries =
                        selected.mapIndexed { index, uri ->
                            if (guard.get()) throw CancellationException()
                            try {
                                catalog.selected(uri).let {
                                    NativeUploadEntry(uri, it.name, it.size)
                                }
                            } catch (reason: Exception) {
                                NativeUploadEntry(
                                    uri,
                                    "文件 ${index + 1}",
                                    error = safeMessage(reason),
                                )
                            }
                        }
                    publish(ticket, NativeUploadState(mode, NativeUploadPhase.READY, entries))
                } catch (reason: CancellationException) {
                    val remaining =
                        selected.map { NativeUploadEntry(it, it.lastPathSegment ?: "所选文件") }
                    publish(
                        ticket,
                        NativeUploadState(
                            mode,
                            NativeUploadPhase.FINISHED,
                            remaining,
                            remaining = remaining,
                            cancelled = true,
                        ),
                    )
                } catch (reason: Exception) {
                    publish(
                        ticket,
                        NativeUploadState(
                            mode,
                            NativeUploadPhase.FINISHED,
                            emptyList(),
                            current = safeMessage(reason),
                        ),
                    )
                }
            }
    }

    fun start(uploaded: Int = 0, skipped: Int = 0, done: Set<Uri> = emptySet()) {
        val current = mutable.value ?: return
        if (current.phase != NativeUploadPhase.READY) return
        // Pause/halt can arrive while metadata is still being read. The READY state is emitted
        // afterwards by the prepare job, so this final main-thread gate must win over it.
        if (!uploadMayStart(current.phase, cancelled.get()) || paused.get()) {
            publish(
                generation.get(),
                current.copy(
                    phase = NativeUploadPhase.FINISHED,
                    cancelled = true,
                    current = "",
                    remaining = current.entries.filter { it.uri !in done },
                    completedEntries = done,
                ),
            )
            return
        }
        run(
            current.entries,
            current.copy(
                phase = NativeUploadPhase.RUNNING,
                uploaded = uploaded,
                skipped = skipped,
                completedEntries = done,
            ),
        )
    }

    fun pause() {
        paused.set(true)
    }

    fun resume() {
        paused.set(false)
    }

    private fun run(entries: List<NativeUploadEntry>, initial: NativeUploadState) {
        val connection = session ?: return
        val target = identity
        val authEpoch = sessionEpoch
        val taskJournal = journal
        val mode = initial.mode
        val modeName = mode.name
        val ticket = generation.incrementAndGet()
        val cancellation = AtomicBoolean().also { cancelled = it }
        val pauseGuard = paused
        val requestGuard = NativeTransferCancellation().also { requestCancellation = it }
        val budget = UploadBudget.shared()
        if (budget.idle()) budget.resetForBatch()
        mutable.value = initial
        val verifying = Collections.synchronizedSet(mutableSetOf<String>())

        fun check() {
            if (cancellation.get() || generation.get() != ticket) throw CancellationException()
            connection.checkAuthorization(authEpoch)
        }

        fun updateState(block: (NativeUploadState) -> NativeUploadState) {
            mutable.update { value ->
                if (generation.get() == ticket && value != null) block(value) else value
            }
        }

        fun updateItem(uri: String, block: (NativeUploadItemProgress) -> NativeUploadItemProgress) {
            updateState { value ->
                val progress = value.items[uri] ?: NativeUploadItemProgress()
                value.copy(items = value.items + (uri to block(progress)))
            }
        }

        fun markIssue(entry: NativeUploadEntry, reason: String): Boolean {
            val uri = entry.uri.toString()
            verifying.remove(uri)
            var added = false
            updateState { value ->
                if (entry.uri in value.completedEntries) {
                    value
                } else {
                    added = true
                    value.copy(
                        issues = value.issues + NativeUploadIssue(entry, reason),
                        items =
                            value.items +
                                (uri to
                                    (value.items[uri] ?: NativeUploadItemProgress())
                                        .copy(active = false, verifying = false, stage = "")),
                    )
                }
            }
            return added
        }

        fun settleFailure() {
            updateState { value -> value.copy(uploaded = (value.uploaded - 1).coerceAtLeast(0)) }
        }

        fun path(): String = "/api/" + (if (modeName == "PHOTO") "photos" else "eagle") + "/uploads"

        job =
            scope.launch(Dispatchers.IO) {
                var tracker: IngestionTracker? = null
                try {
                    check()
                    val me =
                        connection.jsonAtEpoch(
                            authEpoch,
                            "GET",
                            "/api/auth/me",
                            cancellation = requestGuard,
                        )
                    val actual =
                        com.sekereagle.android.core.BackupPolicy.digest(
                            "${connection.origin}\n${me.getJSONObject("desktopCache").getString("deploymentId")}\n${me.getJSONObject("user").getString("id")}"
                        )
                    if (actual != target) throw NativeSession.Failure(401)
                    val catalog = MediaCatalog(app)
                    val uploadsPath = path()
                    val checkApi = NativeUploadApi(connection, authEpoch, {}, {}, requestGuard)
                    val batcher =
                        ContentCheckBatcher { items ->
                            val batch = JSONArray()
                            items.forEach { batch.put(JSONObject().put("contentSha256", it.hash).put("size", it.size)) }
                            val exists =
                                checkApi
                                    .request(
                                        "POST",
                                        "$uploadsPath/check-content-batch",
                                        JSONObject().put("items", batch),
                                    )
                                    .getJSONArray("exists")
                            BooleanArray(items.size) { index ->
                                index < exists.length() && exists.getBoolean(index)
                            }
                        }
                    val polling =
                        IngestionTracker.Poll { pollMode, ids ->
                            val sessions = JSONArray()
                            ids.forEach { sessions.put(it) }
                            val items =
                                checkApi
                                    .request(
                                        "POST",
                                        "/api/" +
                                            (if (pollMode == "PHOTO") "photos" else "eagle") +
                                            "/uploads/status-batch",
                                        JSONObject().put("uploadSessionIds", sessions),
                                    )
                                    .getJSONArray("items")
                            val statuses = HashMap<String, IngestionTracker.Status>()
                            for (index in 0 until items.length()) {
                                val item = items.getJSONObject(index)
                                statuses[item.getString("id")] =
                                    IngestionTracker.Status(
                                        item.optString("status"),
                                        if (item.isNull("eagleAssetId")) ""
                                        else item.optString("eagleAssetId"),
                                        item.optString("lastError"),
                                        item.optInt("finalizationAttempts"),
                                        item.optBoolean("objectCleanupPending"),
                                    )
                            }
                            statuses
                        }
                    tracker = IngestionTracker(polling)

                    fun trackPending(entry: NativeUploadEntry, item: MediaCatalog.Item): Boolean {
                        val uri = entry.uri.toString()
                        val engineKey =
                            BackupEngine.fileKey(
                                target,
                                modeName,
                                uri,
                                item.size,
                                item.modified,
                            )
                        val checkpoint = taskJournal.load(engineKey) ?: return false
                        if (!checkpoint.uploaded || checkpoint.session.isEmpty()) return false
                        val content = "$target:$modeName:${checkpoint.hash}:${item.size}"
                        verifying.add(uri)
                        tracker.track(
                            modeName,
                            checkpoint.session,
                            object : IngestionTracker.Observer {
                                override fun completed(sessionId: String) {
                                    verifying.remove(uri)
                                    val current = taskJournal.load(engineKey) ?: return
                                    current.uploaded = true
                                    current.confirmed = true
                                    taskJournal.confirm(engineKey, content, current)
                                    updateState { value ->
                                        value.copy(
                                            completedEntries = value.completedEntries + entry.uri,
                                            issues =
                                                value.issues.filterNot {
                                                    it.entry.uri == entry.uri
                                                },
                                            items =
                                                value.items +
                                                    (uri to
                                                        (value.items[uri]
                                                                ?: NativeUploadItemProgress())
                                                            .copy(
                                                                active = false,
                                                                verifying = false,
                                                                stage = "",
                                                            )),
                                        )
                                    }
                                }

                                override fun failed(sessionId: String, error: String) {
                                    verifying.remove(uri)
                                    val current = taskJournal.load(engineKey)
                                    if (current != null) {
                                        // The server session is dead; a retry starts fresh.
                                        current.uploaded = false
                                        current.session = ""
                                        current.partSize = 0
                                        current.terminalError = error
                                        taskJournal.save(engineKey, current)
                                    }
                                    if (markIssue(entry, error)) settleFailure()
                                }

                                override fun stillPending(sessionId: String) {
                                    verifying.remove(uri)
                                    if (markIssue(entry, "服务器仍在确认入库，可在图库查看或稍后重试"))
                                        settleFailure()
                                }
                            },
                        )
                        return true
                    }

                    suspend fun processEntry(entry: NativeUploadEntry) {
                        val uri = entry.uri.toString()
                        updateItem(uri) {
                            it.copy(active = true, verifying = false, stage = "校验原文件", bytes = 0, size = entry.size)
                        }
                        updateState { it.copy(current = entry.name, stage = "校验原文件", bytes = 0, size = entry.size) }
                        var lastUpdate = 0L
                        try {
                            val item = catalog.selected(entry.uri)
                            updateItem(uri) { it.copy(size = item.size) }
                            val api =
                                NativeUploadApi(
                                    connection,
                                    authEpoch,
                                    { stage ->
                                        updateItem(uri) { it.copy(stage = stage, bytes = 0) }
                                        updateState { it.copy(stage = stage, bytes = 0, size = item.size) }
                                    },
                                    { bytes ->
                                        val now = android.os.SystemClock.elapsedRealtime()
                                        if (now - lastUpdate > 100 || bytes >= item.size) {
                                            lastUpdate = now
                                            val clamped = bytes.coerceAtMost(item.size)
                                            updateItem(uri) { it.copy(bytes = clamped) }
                                            updateState { it.copy(bytes = clamped) }
                                        }
                                    },
                                    requestGuard,
                                )
                            val engineKey =
                                BackupEngine.fileKey(target, modeName, uri, item.size, item.modified)
                            val existing = taskJournal.load(engineKey)
                            // A file already accepted only needs ingestion polling; re-reading it
                            // would waste a full pass before every resume.
                            val pendingResume =
                                existing != null &&
                                    existing.uploaded &&
                                    !existing.confirmed &&
                                    item.modified > 0
                            val hash =
                                if (pendingResume) null
                                else
                                    catalog.hash(item, ::check) { bytes ->
                                        val now = android.os.SystemClock.elapsedRealtime()
                                        if (now - lastUpdate > 100 || bytes == item.size) {
                                            lastUpdate = now
                                            updateItem(uri) { it.copy(bytes = bytes) }
                                            updateState { it.copy(bytes = bytes, size = item.size) }
                                        }
                                    }
                            if (hash != null) taskJournal.verifyContent(engineKey, hash)
                            val result =
                                UploadPipeline.process(
                                    catalog,
                                    api,
                                    taskJournal,
                                    budget,
                                    batcher,
                                    null,
                                    target,
                                    modeName,
                                    item,
                                    ::check,
                                    hash,
                                    { bytes ->
                                        val now = android.os.SystemClock.elapsedRealtime()
                                        if (now - lastUpdate > 100 || bytes == item.size) {
                                            lastUpdate = now
                                            updateItem(uri) { it.copy(bytes = bytes) }
                                        }
                                    },
                                    { bytes ->
                                        val now = android.os.SystemClock.elapsedRealtime()
                                        if (now - lastUpdate > 100 || bytes >= item.size) {
                                            lastUpdate = now
                                            val clamped = bytes.coerceAtMost(item.size)
                                            updateItem(uri) { it.copy(bytes = clamped) }
                                            updateState { it.copy(bytes = clamped) }
                                        }
                                    },
                                    { stage ->
                                        updateItem(uri) { it.copy(stage = stage) }
                                        updateState { it.copy(stage = stage) }
                                    },
                                )
                            check()
                            when (result) {
                                BackupEngine.Result.SKIPPED -> {
                                    updateState { value ->
                                        value.copy(
                                            skipped = value.skipped + 1,
                                            completedEntries = value.completedEntries + entry.uri,
                                            items =
                                                value.items +
                                                    (uri to
                                                        (value.items[uri]
                                                                ?: NativeUploadItemProgress())
                                                            .copy(
                                                                active = false,
                                                                verifying = false,
                                                                stage = "",
                                                                bytes = item.size,
                                                            )),
                                        )
                                    }
                                }
                                BackupEngine.Result.PENDING,
                                BackupEngine.Result.UPLOADED -> {
                                    updateState { value ->
                                        value.copy(
                                            items =
                                                value.items +
                                                    (uri to
                                                        (value.items[uri]
                                                                ?: NativeUploadItemProgress())
                                                            .copy(
                                                                active = false,
                                                                verifying = true,
                                                                stage = "已上传，入库校验中",
                                                                bytes = item.size,
                                                                size = item.size,
                                                            )),
                                        )
                                    }
                                    // A resumed PENDING entry was already counted by the batch.
                                    if (!pendingResume)
                                        updateState { value ->
                                            value.copy(uploaded = value.uploaded + 1)
                                        }
                                    updateState {
                                        it.copy(stage = "服务器确认入库", bytes = item.size, size = item.size)
                                    }
                                    if (!trackPending(entry, item))
                                        markIssue(entry, "上传未完成，请重试")
                                }
                            }
                        } catch (reason: CancellationException) {
                            throw reason
                        } catch (reason: BackupEngine.MemoryPressure) {
                            pauseGuard.set(true)
                            markIssue(entry, safeMessage(reason))
                        } catch (reason: Exception) {
                            if (cancellation.get() || reason is CancellationException) throw CancellationException()
                            if (
                                (reason is ApiClient.Failure && reason.invalidatesCredential()) ||
                                    (reason is NativeSession.Failure && reason.status == 401)
                            ) {
                                withContext(Dispatchers.Main) {
                                    if (generation.get() == ticket) unauthorized(connection)
                                }
                                throw CancellationException()
                            }
                            markIssue(entry, safeMessage(reason))
                        }
                    }

                    val queue = ConcurrentLinkedQueue(entries)
                    coroutineScope {
                        repeat(minOf(UploadBudget.NORMAL_FILES, entries.size)) {
                            launch(Dispatchers.IO) {
                                while (true) {
                                    if (cancellation.get()) break
                                    while (pauseGuard.get() && !cancellation.get()) delay(200)
                                    if (cancellation.get()) break
                                    val entry = queue.poll() ?: break
                                    try {
                                        budget.acquireFile()
                                    } catch (interrupted: InterruptedException) {
                                        Thread.currentThread().interrupt()
                                        break
                                    }
                                    try {
                                        processEntry(entry)
                                    } finally {
                                        budget.releaseFile()
                                    }
                                }
                            }
                        }
                    }

                    val deadline = android.os.SystemClock.elapsedRealtime() + 10 * 60_000L
                    while (
                        tracker.size() > 0 &&
                            !cancellation.get() &&
                            !pauseGuard.get() &&
                            android.os.SystemClock.elapsedRealtime() < deadline
                    )
                        delay(250)
                    if (
                        tracker.size() > 0 &&
                            !cancellation.get() &&
                            !pauseGuard.get()
                    ) {
                        val still = synchronized(verifying) { verifying.toSet() }
                        for (entry in entries) {
                            if (entry.uri.toString() in still &&
                                markIssue(entry, "服务器仍在确认入库，可在图库查看或稍后重试"))
                                settleFailure()
                        }
                    }
                } catch (reason: Exception) {
                    if (reason is NativeSession.Failure && reason.status == 401) {
                        withContext(Dispatchers.Main) {
                            if (generation.get() == ticket) unauthorized(connection)
                        }
                        return@launch
                    }
                    if (reason is CancellationException || cancellation.get()) {
                        // The final state below keeps unfinished entries for a later resume.
                    } else {
                        updateState { value -> value.copy(current = safeMessage(reason)) }
                    }
                } finally {
                    tracker?.close()
                    val snapshot = mutable.value ?: initial
                    val unfinished =
                        entries.filter { entry ->
                            entry.uri !in snapshot.completedEntries &&
                                snapshot.issues.none { it.entry.uri == entry.uri }
                        }
                    publish(
                        ticket,
                        snapshot.copy(
                            phase = NativeUploadPhase.FINISHED,
                            cancelled = cancellation.get() || pauseGuard.get(),
                            remaining = unfinished,
                        ),
                    )
                    if (
                        generation.get() == ticket &&
                            (snapshot.uploaded > 0 || snapshot.skipped > 0)
                    )
                        withContext(NonCancellable + Dispatchers.Main) {
                            if (generation.get() == ticket) completed(target, mode)
                        }
                }
            }
    }

    fun retry() {
        val old = mutable.value ?: return
        if (old.phase != NativeUploadPhase.FINISHED) return
        val entries = (old.issues.map { it.entry } + old.remaining).distinctBy { it.uri }
        if (entries.isEmpty()) return
        journal.retryFailures()
        paused = AtomicBoolean()
        run(
            entries,
            old.copy(
                phase = NativeUploadPhase.RUNNING,
                issues = emptyList(),
                remaining = emptyList(),
                current = "",
                cancelled = false,
            ),
        )
    }

    fun cancel() {
        cancelled.set(true)
        requestCancellation.cancel()
    }

    internal suspend fun awaitStopped() {
        job?.join()
    }

    fun dismiss() {
        val phase = mutable.value?.phase
        if (phase != NativeUploadPhase.RUNNING && phase != NativeUploadPhase.PREPARING) clear()
    }

    fun clear() {
        generation.incrementAndGet()
        cancelled.set(true)
        paused.set(true)
        requestCancellation.cancel()
        job?.cancel()
        session = null
        identity = ""
        sessionEpoch = 0
        journal = journalStore ?: NativeUploadPolicy.Journal()
        mutable.value = null
    }

    private fun publish(ticket: Int, value: NativeUploadState) {
        mutable.update { if (generation.get() == ticket) value else it }
    }

    private fun safeMessage(reason: Exception): String =
        when (reason) {
            is SecurityException -> "文件访问权限已失效，请重新选择"
            is IOException -> reason.message?.takeUnless { it.contains("://") } ?: "网络或文件读取失败，请重试"
            else -> "文件未能上传，请重新选择或重试"
        }
}
