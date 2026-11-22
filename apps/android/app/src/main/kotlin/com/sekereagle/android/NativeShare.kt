package com.sekereagle.android

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.sekereagle.android.core.NativeDownloadPolicy
import com.sekereagle.android.core.NativeGalleryPolicy
import com.sekereagle.android.core.NativeSharePolicy
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * System sharing prefers a server-rendered 4K JPEG for still images and the compatible MP4 playback
 * copy for video. An explicit "original" action remains available through the failure fallback.
 */
internal suspend fun shareNativeAsset(
    context: Context,
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
    onStage: (String) -> Unit = {},
    onProgress: (Long, Long) -> Unit = { _, _ -> },
) {
    val directory = File(context.cacheDir, "shared-media").apply { mkdirs() }
    cleanupShared(directory)
    val mime = asset.mimeType
    var source = NativeSharePolicy.source(asset.video, mime, asset.playback != null)
    var file: File
    var shareMime = mime
    if (source == NativeSharePolicy.Source.SHARE_IMAGE) {
        val fourK = NativeSharePolicy.fourK(asset.width, asset.height)
        onStage(if (fourK) "正在生成 4K 分享图…" else "正在准备分享图…")
        try {
            file =
                shareImageFile(
                    context,
                    repo,
                    mode,
                    asset,
                    directory,
                    cancellation,
                    onProgress,
                )
            shareMime = "image/jpeg"
        } catch (reason: Exception) {
            if (reason is CancellationException) throw reason
            if (reason is NativeSession.Failure && reason.status == 401) throw reason
            onStage("分享图生成失败，正在改发原图…")
            source = NativeSharePolicy.Source.ORIGINAL
            file =
                prepareOriginal(
                    context,
                    repo,
                    mode,
                    asset,
                    directory,
                    cancellation,
                    onStage,
                    onProgress,
                )
        }
    } else if (source == NativeSharePolicy.Source.PLAYBACK) {
        onStage("正在准备兼容视频…")
        try {
            file =
                preparePlayback(
                    repo,
                    asset,
                    directory,
                    cancellation,
                    onStage,
                    onProgress,
                )
            shareMime = "video/mp4"
        } catch (reason: Exception) {
            if (reason is CancellationException) throw reason
            if (reason is NativeSession.Failure && reason.status == 401) throw reason
            onStage("兼容视频暂不可用，正在准备原文件…")
            source = NativeSharePolicy.Source.ORIGINAL
            file =
                prepareOriginal(
                    context,
                    repo,
                    mode,
                    asset,
                    directory,
                    cancellation,
                    onStage,
                    onProgress,
                )
        }
    } else {
        file =
            prepareOriginal(
                context,
                repo,
                mode,
                asset,
                directory,
                cancellation,
                onStage,
                onProgress,
            )
    }
    cancellation.check()
    onStage("正在打开分享…")
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.share", file)
    withContext(Dispatchers.Main) {
        cancellation.check()
        val intent =
            Intent(Intent.ACTION_SEND)
                .setType(shareMime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri(asset.name, uri)
        context.startActivity(
            Intent.createChooser(intent, "分享").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        )
    }
}

private suspend fun shareImageFile(
    context: Context,
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    asset: NativeAsset,
    directory: File,
    cancellation: NativeTransferCancellation,
    onProgress: (Long, Long) -> Unit,
): File {
    val name = "share-${asset.id}-${asset.revision}.jpg"
    val cached = File(directory, name)
    if (cached.length() > 0) {
        onProgress(cached.length(), cached.length())
        return cached
    }
    val temporary = File(directory, ".${name}.part")
    if (temporary.exists()) temporary.delete()
    try {
        val path =
            NativeGalleryPolicy.base(mode.name) +
                "/assets/" +
                NativeGalleryPolicy.identifier(asset.id) +
                "/share-image"
        temporary.outputStream().use { output ->
            repo.connection.downloadShareImage(path, output, cancellation, onProgress)
        }
        cancellation.check()
        if (!temporary.renameTo(cached)) throw IOException("无法保存分享图，请检查存储空间")
        return cached
    } catch (reason: Throwable) {
        temporary.delete()
        throw reason
    }
}

private suspend fun preparePlayback(
    repo: NativeGalleryRepository,
    asset: NativeAsset,
    directory: File,
    cancellation: NativeTransferCancellation,
    onStage: (String) -> Unit,
    onProgress: (Long, Long) -> Unit,
): File {
    val playback = asset.playback ?: throw IOException("兼容视频尚未就绪")
    onStage("正在准备兼容视频…")
    val directoryId = java.util.UUID.randomUUID().toString()
    val target =
        File(directory, directoryId).apply { mkdirs() }.let { folder ->
            File(folder, NativeSharePolicy.playbackFileName(asset.name))
        }
    target.outputStream().use { output ->
        repo.connection.downloadOriginal(
            playback,
            asset.playbackSize,
            "video/mp4",
            output,
            cancellation,
        ) { total -> onProgress(total, asset.playbackSize) }
    }
    cancellation.check()
    return target
}

private suspend fun prepareOriginal(
    context: Context,
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    asset: NativeAsset,
    directory: File,
    cancellation: NativeTransferCancellation,
    onStage: (String) -> Unit,
    onProgress: (Long, Long) -> Unit,
): File {
    onStage("正在准备原文件…")
    return repo.original(
            context,
            mode,
            asset,
            cancellation,
            maxBytes = NativeSharePolicy.MAX_SHARE_ORIGINAL_BYTES,
        )
        .use { original ->
            val directoryId = java.util.UUID.randomUUID().toString()
            val folder = File(directory, directoryId).apply { mkdirs() }
            val target =
                File(
                    folder,
                    NativeDownloadPolicy.fileName(original.metadata.getString("originalName")),
                )
            if (!original.file.renameTo(target))
                throw IOException("无法准备分享文件，请检查存储空间")
            onProgress(target.length(), target.length())
            target
        }
}

private fun cleanupShared(directory: File) {
    val now = System.currentTimeMillis()
    directory
        .listFiles()
        ?.filter {
            val ttl = if (it.isFile && it.name.startsWith("share-")) 7L else 1L
            it.lastModified() in 1 until now - ttl * 24 * 60 * 60 * 1000
        }
        ?.forEach { it.deleteRecursively() }
}
