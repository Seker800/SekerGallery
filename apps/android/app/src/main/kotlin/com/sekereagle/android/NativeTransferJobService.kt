package com.sekereagle.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/** Keeps a user-initiated manual transfer alive without the dataSync 6-hour foreground budget. */
@RequiresApi(34)
class NativeTransferJobService : JobService() {
    private val lifetime = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: NativeTransferManager
    private var scope = ""
    private var params: JobParameters? = null
    private var observe: Job? = null
    private var finished = false
    private var stopped = false
    private var wake: PowerManager.WakeLock? = null
    private var wakeUntil = 0L

    override fun onCreate() {
        super.onCreate()
        manager = NativeTransferManager.get(this)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(CHANNEL, "文件传输", NotificationManager.IMPORTANCE_LOW)
            )
    }

    override fun onStartJob(job: JobParameters): Boolean {
        scope = BackupSettings(this).active()
        if (scope.isEmpty()) {
            finish(false)
            return false
        }
        params = job
        finished = false
        stopped = false
        NativeTransferLauncher.markStarted(scope)
        notify(job, "正在准备传输")
        manager.dispatch(scope)
        keepAwake(true)
        observe?.cancel()
        observe =
            lifetime.launch {
                combine(manager.state, manager.downloads.state) { queue, download ->
                        queue to download
                    }
                    .collectLatest { (queue, download) ->
                        val own = queue.batches.filter { it.scope == scope }
                        val batch = own.firstOrNull { it.id == queue.activeId }
                        val active =
                            own.any { it.waiting || it.id == queue.activeId } ||
                                download?.running == true
                        val text =
                            when {
                                batch != null -> {
                                    val progress = batch.progress
                                    if (progress == null) batch.message
                                    else
                                        "${batch.mode.title} · ${progress.uploaded + progress.skipped}/${batch.entries.size} · ${batch.message}"
                                }
                                download?.running == true ->
                                    "已保存 ${download.completed}/${download.total} · ${download.current}"
                                else -> queue.error ?: "正在准备传输"
                            }
                        notify(job, text)
                        keepAwake(false)
                        if (!active) finish(false)
                    }
            }
        return true
    }

    override fun onStopJob(job: JobParameters): Boolean {
        stopped = true
        NativeTransferLauncher.markStopped(scope)
        manager.halt(scope, "系统暂停了传输，回到传输列表继续")
        manager.downloads.cancel()
        observe?.cancel()
        observe = null
        params = null
        releaseWake()
        stopSelf()
        return true
    }

    override fun onDestroy() {
        NativeTransferLauncher.markStopped(scope)
        observe?.cancel()
        if (!finished && !stopped && scope.isNotEmpty())
            manager.halt(scope, "后台服务已停止，点击继续")
        lifetime.cancel()
        releaseWake()
        super.onDestroy()
    }

    private fun finish(retry: Boolean) {
        if (finished) return
        finished = true
        NativeTransferLauncher.markStopped(scope)
        observe?.cancel()
        observe = null
        val job = params
        params = null
        releaseWake()
        if (!stopped && job != null) runCatching { jobFinished(job, retry) }
        stopSelf()
    }

    private fun notify(job: JobParameters, text: String) {
        if (stopped || finished || Build.VERSION.SDK_INT < 34) return
        runCatching {
            setNotification(
                job,
                NOTICE,
                notification(text),
                JobService.JOB_END_NOTIFICATION_POLICY_REMOVE,
            )
        }
    }

    private fun notification(text: String): Notification {
        val open =
            PendingIntent.getActivity(
                this,
                84,
                Intent(this, NativeActivity::class.java)
                    .putExtra("transfers", true)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("SekerEagle 传输列表")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun keepAwake(force: Boolean) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && wake?.isHeld == true && now < wakeUntil) return
        if (wake?.isHeld == true) wake?.release()
        wake =
            getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SekerEagle:ManualTransferJob")
                .apply { acquire(30 * 60 * 1000L) }
        wakeUntil = now + 25 * 60 * 1000L
    }

    private fun releaseWake() {
        if (wake?.isHeld == true) wake?.release()
        wake = null
    }

    companion object {
        private const val CHANNEL = "native-file-transfers"
        private const val NOTICE = 84
    }
}
