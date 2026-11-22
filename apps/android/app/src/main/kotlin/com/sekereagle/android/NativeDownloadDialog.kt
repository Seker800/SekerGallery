package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
internal fun NativeDownloadDialog(
    state: NativeDownloadState,
    downloads: NativeDownloads,
    onHide: () -> Unit,
) {
    var confirmCancel by remember { mutableStateOf(false) }
    AlertDialog(
        containerColor = androidx.compose.ui.graphics.Color(0xFF1C1C1F),
        modifier = Modifier.testTag("native-download-dialog"),
        // Closing the dialog must never cancel a running transfer by accident.
        onDismissRequest = onHide,
        title = {
            Text(
                if (state.running) "正在下载原件"
                else if (state.cancelled) "下载已取消"
                else "下载结果"
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "已保存 ${state.completed} / ${state.total} 项",
                    Modifier.testTag("download-summary"),
                )
                if (state.running) {
                    Text(state.current, maxLines = 2)
                    if (state.size > 0) {
                        LinearProgressIndicator(
                            progress = {
                                (state.bytes.toDouble() / state.size).toFloat().coerceIn(0f, 1f)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text("${state.bytes / 1024} / ${state.size / 1024} KB", color = NativeMuted)
                    } else LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Text("保存到：Download/SekerEagle", color = NativeMuted)
                Text(
                    if (state.running)
                        "关闭此窗口后下载继续，可从通知栏或图库下方进度条重新打开。应用进程被系统终止后，需重新选择未完成项。"
                    else "应用进程被系统终止后，需重新选择未完成项。",
                    color = NativeMuted,
                )
                if (state.failures.isNotEmpty())
                    Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                        Text("${state.failures.size} 项失败", color = MaterialTheme.colorScheme.error)
                        state.failures.forEach {
                            Text("${it.asset.name}：${it.reason}", Modifier.padding(top = 8.dp))
                        }
                    }
                if (state.remaining.isNotEmpty())
                    Text("${state.remaining.size} 项未完成，可重试", color = NativeMuted)
            }
        },
        confirmButton = {
            if (state.running) TextButton(onHide) { Text("后台继续") }
            else
                TextButton({
                    downloads.dismiss()
                    onHide()
                }) {
                    Text("完成")
                }
        },
        dismissButton = {
            if (state.running) TextButton({ confirmCancel = true }) { Text("取消下载") }
            else if (state.failures.isNotEmpty() || state.remaining.isNotEmpty())
                TextButton(downloads::retry) { Text("重试未完成项") }
        },
    )
    if (confirmCancel)
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text("取消下载？") },
            text = { Text("已经保存的文件会保留，未完成的项目可在结果中重试。") },
            dismissButton = { TextButton({ confirmCancel = false }) { Text("继续下载") } },
            confirmButton = {
                TextButton({
                    confirmCancel = false
                    downloads.cancel()
                }) {
                    Text("取消下载")
                }
            },
        )
}
