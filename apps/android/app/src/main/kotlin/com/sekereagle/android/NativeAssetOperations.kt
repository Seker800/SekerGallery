package com.sekereagle.android

import com.sekereagle.android.core.NativeGalleryPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal data class NativeAssetOperation(
    val id: String,
    val mode: GalleryMode,
    val kind: String,
    val total: Int,
    val completed: Int,
    val failed: Int,
    val cancelled: Int,
    val queued: Int,
    val running: Int,
    val state: String = "",
) {
    val pending
        get() = queued + running > 0 && state !in setOf("COMPLETED", "STOPPED")

    val title
        get() =
            when (kind) {
                "SEND" -> if (mode == GalleryMode.PHOTO) "发送到素材" else "发送到照片"
                "TRASH" -> "移入回收站"
                "RESTORE" -> "恢复"
                else -> "清空回收站"
            }

    val progress
        get() =
            "已完成 $completed/$total" +
                (if (pending) " · 正在处理" else "") +
                (if (failed > 0) " · 失败 $failed 项" else "") +
                (if (cancelled > 0) " · 已取消 $cancelled 项" else "")
}

/** Uses the shared server queue: accepting a command never retires local source cards. */
internal class NativeAssetOperations(private val session: NativeSession) {
    suspend fun send(mode: GalleryMode, ids: Set<String>, operationId: String): String =
        withContext(Dispatchers.IO) {
            require(ids.isNotEmpty())
            enqueue(mode, "SEND", ids, operationId).id
        }

    suspend fun enqueue(
        mode: GalleryMode,
        kind: String,
        ids: Set<String>,
        operationId: String = java.util.UUID.randomUUID().toString(),
    ): NativeAssetOperation =
        withContext(Dispatchers.IO) {
            require(ids.isNotEmpty())
            require(kind in setOf("SEND", "TRASH", "RESTORE", "EMPTY_TRASH"))
            val result =
                session.json(
                    "POST",
                    "${NativeGalleryPolicy.base(mode.name)}/operations",
                    JSONObject()
                        .put("kind", kind)
                        .put("operationId", operationId)
                        .put("assetIds", JSONArray(ids.map { NativeGalleryPolicy.identifier(it) })),
                )
            parse(result, mode)
        }

    suspend fun list(): List<NativeAssetOperation> =
        withContext(Dispatchers.IO) {
            GalleryMode.entries.flatMap { mode ->
                val rows =
                    session.array(
                        "${NativeGalleryPolicy.base(mode.name)}/operations?publicOnly=true"
                    )
                (0 until rows.length()).map { index -> parse(rows.getJSONObject(index), mode) }
            }
        }

    /** Polls the bounded active/recent projection until the operation reaches a terminal state. */
    suspend fun await(
        mode: GalleryMode,
        id: String,
        timeoutMs: Long = 180_000,
    ): NativeAssetOperation? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val current = list().firstOrNull { it.id == id && it.mode == mode }
            if (current != null && !current.pending) return current
            delay(1_000)
        }
        return list().firstOrNull { it.id == id && it.mode == mode }
    }

    private fun parse(row: JSONObject, mode: GalleryMode) =
        NativeAssetOperation(
            row.getString("id"),
            mode,
            row.getString("kind"),
            row.optInt("total"),
            row.optInt("completed"),
            row.optInt("failed"),
            row.optInt("cancelled"),
            row.optInt("queued"),
            row.optInt("running"),
            row.optString("state"),
        )
}
