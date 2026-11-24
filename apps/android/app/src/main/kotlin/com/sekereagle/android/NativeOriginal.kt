package com.sekereagle.android

import android.content.Context
import android.graphics.ImageDecoder
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Retry only interrupted reads; mutations, authorization and validation failures never retry. */
internal suspend fun <T> retryOriginalRead(
    cancellation: NativeTransferCancellation,
    read: (Int) -> T,
): T {
    for (attempt in 0..2) {
        cancellation.check()
        try {
            return read(attempt)
        } catch (reason: IOException) {
            cancellation.check()
            if (
                reason !is java.net.SocketException &&
                    reason !is java.net.SocketTimeoutException &&
                    reason !is java.net.ProtocolException &&
                    reason !is java.io.EOFException
            )
                throw reason
            if (attempt == 2) throw IOException("照片读取中断，请检查网络后重试", reason)
            kotlinx.coroutines.delay(250L * (attempt + 1))
        }
    }
    error("读取重试已结束")
}

/** Private, short-lived files. No original enters the thumbnail cache or a gallery prefetch. */
internal class NativeOriginal(val file: File, val metadata: JSONObject) : AutoCloseable {
    override fun close() {
        file.delete()
    }
}

internal suspend fun NativeGalleryRepository.original(
    context: Context,
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
    editable: Boolean = false,
    normalize: Boolean = editable,
    maxBytes: Long = Long.MAX_VALUE,
): NativeOriginal =
    withContext(Dispatchers.IO) {
        val base =
            NativeGalleryPolicy.base(mode.name) +
                "/assets/" +
                NativeGalleryPolicy.identifier(asset.id)
        val epoch = connection.authorizationEpoch()
        val metadata =
            retryOriginalRead(cancellation) {
                connection.jsonAtEpoch(epoch, "GET", base, cancellation = cancellation)
            }
        if (metadata.getInt("mediaRevision") != asset.revision) throw IOException("原件已更新，请刷新后重试")
        var sourcePath = "$base/original"
        var size = metadata.getLong("byteSize")
        var mime = metadata.getString("mimeType")
        if (
            normalize &&
                mime !in
                    listOf(
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "image/heic",
                        "image/heif",
                        "image/avif",
                    ) &&
                mime.startsWith("image/")
        ) {
            val rows = metadata.getJSONArray("renditions")
            val normalized =
                (0 until rows.length())
                    .map { rows.getJSONObject(it) }
                    .firstOrNull {
                        it.optInt("revision") == asset.revision &&
                            it.optString("kind") == "PREVIEW" &&
                            it.optString("variant") == "edit" &&
                            it.optString("mimeType") == "image/webp"
                    } ?: throw IOException("高清显影尚未就绪，请稍后重试")
            sourcePath =
                NativeGalleryPolicy.mediaPath(mode.name, asset.id, normalized.getString("id"))
            size = normalized.getLong("byteSize")
            mime = normalized.getString("mimeType")
        }
        if (editable && mime !in listOf("image/jpeg", "image/png", "image/webp"))
            throw IOException("此格式暂不支持编辑，请使用可编辑照片或 RAW 显影副本")
        if (size > maxBytes)
            throw IOException("文件较大，无法读取，请下载原文件")
        if (normalize && !editable && size > 256L * 1024 * 1024)
            throw IOException("原图超出查看读取预算，请下载原件查看")
        if (editable && size > 64L * 1024 * 1024) throw IOException("照片超出编辑读取预算")
        val directory = File(context.cacheDir, "viewer-originals").apply { mkdirs() }
        val file = File.createTempFile("source-", ".media", directory)
        try {
            fun validateCurrent() {
                val current =
                    connection.jsonAtEpoch(epoch, "GET", base, cancellation = cancellation)
                if (
                    current.getInt("mediaRevision") != asset.revision ||
                        current.getLong("byteSize") != metadata.getLong("byteSize")
                )
                    throw IOException("读取期间原件发生变化，请刷新后重试")
            }
            retryOriginalRead(cancellation) { attempt ->
                connection.checkAuthorization(epoch)
                if (attempt > 0) validateCurrent()
                file.outputStream().use { output ->
                    connection.downloadOriginal(sourcePath, size, mime, output, cancellation) {}
                }
                validateCurrent()
            }
            cancellation.check()
            NativeOriginal(file, JSONObject(metadata.toString()).put("sourceMime", mime))
        } catch (reason: Throwable) {
            file.delete()
            throw reason
        }
    }

internal fun decodeViewerOriginal(file: File): android.graphics.Bitmap =
    ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
        val pixels = info.size.width.toLong() * info.size.height
        if (pixels <= 0 || pixels > 200_000_000) throw IOException("原图尺寸超出查看预算")
        val ratio = kotlin.math.sqrt((16_000_000.0 / pixels).coerceAtMost(1.0))
        decoder.setTargetSize(
            (info.size.width * ratio).toInt().coerceAtLeast(1),
            (info.size.height * ratio).toInt().coerceAtLeast(1),
        )
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }

/** A decoded-detail source; cached share renderings survive the read, temporary originals do not. */
internal class NativeDetailFile(val file: java.io.File, private val temporary: Boolean) :
    AutoCloseable {
    internal val persistent: Boolean
        get() = !temporary

    override fun close() {
        if (temporary) file.delete()
    }
}

/**
 * Detail viewing uses the bounded 4K share rendering for still images. It is small enough to cache
 * and avoids re-downloading a camera-sized original each time the user zooms; GIF keeps its original
 * bytes so animation is not flattened.
 */
internal suspend fun NativeGalleryRepository.detailImage(
    context: Context,
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
    progress: (Long, Long) -> Unit = { _, _ -> },
): NativeDetailFile =
    withContext(Dispatchers.IO) {
        val animated = asset.mimeType == "image/gif" || asset.mimeType == "image/webp"
        if (!animated && asset.mimeType.startsWith("image/")) {
            val directory = File(context.cacheDir, "viewer-detail").apply { mkdirs() }
            val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
            directory.listFiles()?.filter { it.lastModified() in 1 until cutoff }?.forEach {
                it.deleteRecursively()
            }
            val name = "share-${asset.id}-${asset.revision}.jpg"
            val cached = File(directory, name)
            if (cached.length() > 0) return@withContext NativeDetailFile(cached, false)
            val temporary = File(directory, ".${name}.part")
            try {
                val contentPath = startShareRender(mode, asset, cancellation) {}
                temporary.outputStream().use { output ->
                    connection.downloadShareRendition(
                        contentPath,
                        output,
                        cancellation,
                        progress,
                    )
                }
                cancellation.check()
                if (!temporary.renameTo(cached)) throw IOException("无法保存高清图")
                return@withContext NativeDetailFile(cached, false)
            } catch (reason: Throwable) {
                temporary.delete()
                if (reason is kotlinx.coroutines.CancellationException) throw reason
                if (reason is NativeSession.Failure && reason.status == 401) throw reason
            }
        }
        val original =
            original(
                context,
                mode,
                asset,
                cancellation,
                normalize = !animated,
                maxBytes = 256L * 1024 * 1024,
            )
        NativeDetailFile(original.file, true)
    }
