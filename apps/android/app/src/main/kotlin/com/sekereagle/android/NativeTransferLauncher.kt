package com.sekereagle.android

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build

/** Manual uploads/downloads use a user-initiated data-transfer job on Android 14+. */
internal object NativeTransferLauncher {
    private const val JOB_ID = 7303
    @Volatile private var activeScope = ""

    fun markStarted(scope: String) {
        activeScope = scope
    }

    fun markStopped(scope: String) {
        if (activeScope == scope) activeScope = ""
    }

    fun start(context: Context, scope: String) {
        if (scope.isEmpty()) return
        if (Build.VERSION.SDK_INT >= 34 && activeScope == scope) return
        if (Build.VERSION.SDK_INT >= 34 && schedule(context)) return
        try {
            context.startForegroundService(
                Intent(context, NativeUploadService::class.java).putExtra("scope", scope)
            )
        } catch (_: RuntimeException) {
            // The manager keeps the durable batch; the next resume/enqueue retries the launch.
        }
    }

    @android.annotation.TargetApi(34)
    private fun schedule(context: Context): Boolean {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return false
        val network =
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
        val job =
            JobInfo.Builder(JOB_ID, ComponentName(context, NativeTransferJobService::class.java))
                .setRequiredNetwork(network)
                .setUserInitiated(true)
                .setEstimatedNetworkBytes(1L shl 30, 1L shl 30)
                .build()
        return runCatching { scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS }
            .getOrDefault(false)
    }
}
