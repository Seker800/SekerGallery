package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
internal fun NativeRatingSheet(
    assets: List<NativeAsset>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onApply: (Int?) -> Unit,
) {
    val ratings = assets.map { it.rating }.distinct()
    val mixed = ratings.size > 1
    val current = if (!mixed) ratings.firstOrNull() else null
    var chosen by remember(assets.map { it.id }, mixed, current) { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (assets.size > 1) "设置评分（${assets.size} 项）" else "评分") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    when {
                        mixed -> "所选项目评分不一致"
                        current == null -> "尚未评分"
                        else -> "当前 $current 星"
                    },
                    color = NativeMuted,
                )
                Spacer(Modifier.height(12.dp))
                Row {
                    (1..5).forEach { value ->
                        IconButton(
                            onClick = { chosen = if (chosen == value) null else value },
                            enabled = !busy,
                        ) {
                            Box(
                                Modifier.size(36.dp)
                                    .background(
                                        if ((chosen ?: 0) >= value) Color(0xFFFFD166)
                                        else Color.Transparent,
                                        CircleShape,
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    Icons.Outlined.Star,
                                    "$value 星",
                                    Modifier.size(26.dp),
                                    tint =
                                        if ((chosen ?: 0) >= value) Color(0xFF3A2B00)
                                        else Color.White,
                                )
                            }
                        }
                    }
                }
                TextButton({ onApply(null) }, enabled = !busy) { Text("清除评分") }
            }
        },
        confirmButton = {
            TextButton(
                { onApply(chosen) },
                enabled = !busy && (!mixed || chosen != null),
            ) {
                Text("应用")
            }
        },
        dismissButton = { TextButton(onDismiss, enabled = !busy) { Text("取消") } },
    )
}
