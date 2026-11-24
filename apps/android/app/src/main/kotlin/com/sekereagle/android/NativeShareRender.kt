package com.sekereagle.android

import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * On-demand share rendering. The HTTP request only creates/polls a small job; the permanent
 * rendition is downloaded separately, so the 15-second gateway deadline never bounds the render.
 */
private const val SHARE_RENDER_TIMEOUT_MS = 10 * 60_000L
private const val SHARE_RENDER_OFFLINE_POLLS = 60

internal suspend fun NativeGalleryRepository.startShareRender(
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
    onStage: (String) -> Unit,
): String =
    withContext(Dispatchers.IO) {
        val base =
            NativeGalleryPolicy.base(mode.name) +
                "/assets/" +
                NativeGalleryPolicy.identifier(asset.id) +
                "/share-renders"
        val deadline = System.currentTimeMillis() + SHARE_RENDER_TIMEOUT_MS
        var offlinePolls = 0
        var current = connection.json("POST", base, JSONObject(), cancellation)
        while (true) {
            cancellation.check()
            if (System.currentTimeMillis() > deadline) throw IOException("分享图生成超时")
            when (current.optString("status")) {
                "READY" -> {
                    val content = current.optString("contentUrl")
                    if (content.isBlank()) throw IOException("分享图地址缺失")
                    return@withContext content
                }
                "FAILED", "CANCELLED" -> throw IOException(failureMessage(current.optString("errorCode")))
            }
            offlinePolls =
                if (current.has("rendererOnline") && !current.optBoolean("rendererOnline"))
                    offlinePolls + 1
                else 0
            if (offlinePolls >= SHARE_RENDER_OFFLINE_POLLS)
                throw IOException("渲染服务未就绪")
            onStage(stageLabel(current.optString("stage"), asset))
            delay(700)
            val id = current.optString("id")
            if (id.isBlank()) throw IOException("分享图任务标识缺失")
            current = connection.json("GET", "$base/$id", null, cancellation)
        }
        @Suppress("UNREACHABLE_CODE")
        error("unreachable")
    }

private fun stageLabel(stage: String, asset: NativeAsset): String =
    when (stage) {
        "READING" -> "正在读取原图…"
        "DECODING" -> "正在解码 HEIC/RAW…"
        "ENCODING" ->
            if (maxOf(asset.width, asset.height) >= 4_096) "正在压缩 4K…"
            else "正在压缩分享图…"
        else -> "排队中…"
    }

private fun failureMessage(code: String): String =
    when (code) {
        "ASSET_CHANGED" -> "图片已变化，请重新打开"
        "NOT_IMAGE" -> "仅图片支持分享"
        "SOURCE_MISSING" -> "原图文件不存在"
        "CANCELLED" -> "已取消"
        "INVALID_SPEC" -> "分享图规格无效，请更新客户端"
        else -> "分享图生成失败"
    }
