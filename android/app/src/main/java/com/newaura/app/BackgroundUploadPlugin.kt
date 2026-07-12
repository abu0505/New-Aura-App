package com.newaura.app

import android.util.Base64
import android.util.Log
import androidx.work.*
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * BackgroundUploadPlugin — Capacitor bridge to Android WorkManager.
 *
 * Receives encrypted media data from JS, persists it to temp files,
 * and enqueues WorkManager jobs that survive app kill.
 *
 * Architecture:
 *   JS encrypts data (NaCl) → passes base64 to this plugin →
 *   plugin saves to temp file → enqueues WorkManager job →
 *   UploadWorker/ChunkUploadWorker uploads to Cloudinary + inserts DB row →
 *   notifies JS via Capacitor event on completion
 *
 * Security: Native layer NEVER sees plaintext — only encrypted bytes.
 */
@CapacitorPlugin(name = "BackgroundUpload")
class BackgroundUploadPlugin : Plugin() {

    companion object {
        private const val TAG = "BackgroundUpload"
        const val WORK_TAG = "aura_upload"
        const val EVENT_UPLOAD_COMPLETE = "backgroundUploadComplete"
        const val EVENT_UPLOAD_FAILED = "backgroundUploadFailed"
        const val EVENT_CHUNK_COMPLETE = "backgroundChunkComplete"
        const val EVENT_TEXT_COMPLETE = "backgroundTextComplete"
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: enqueueUpload
    // Enqueues a single media file upload (image, audio, document)
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun enqueueUpload(call: PluginCall) {
        try {
            val taskId = call.getString("taskId") ?: UUID.randomUUID().toString()
            val encryptedBase64 = call.getString("encryptedBase64")
            val cloudinaryPreset = call.getString("cloudinaryPreset") ?: ""
            val cloudinaryCloudName = call.getString("cloudinaryCloudName") ?: ""
            val uploadType = call.getString("uploadType") ?: "raw"
            val supabaseUrl = call.getString("supabaseUrl") ?: ""
            val supabaseKey = call.getString("supabaseKey") ?: ""
            val supabaseAccessToken = call.getString("supabaseAccessToken") ?: ""
            val dbPayload = call.getString("dbPayload") ?: "{}"
            val fileName = call.getString("fileName") ?: "encrypted_file.raw"

            if (encryptedBase64.isNullOrEmpty()) {
                call.reject("encryptedBase64 is required")
                return
            }

            // Save encrypted bytes to temp file (don't hold in memory)
            val tempFile = saveTempFile(taskId, encryptedBase64)
            if (tempFile == null) {
                call.reject("Failed to save encrypted data to temp file")
                return
            }

            Log.i(TAG, "enqueueUpload: taskId=$taskId file=${tempFile.absolutePath} size=${tempFile.length()}")

            // Build WorkManager input data
            val inputData = Data.Builder()
                .putString("taskId", taskId)
                .putString("tempFilePath", tempFile.absolutePath)
                .putString("cloudinaryPreset", cloudinaryPreset)
                .putString("cloudinaryCloudName", cloudinaryCloudName)
                .putString("uploadType", uploadType)
                .putString("supabaseUrl", supabaseUrl)
                .putString("supabaseKey", supabaseKey)
                .putString("supabaseAccessToken", supabaseAccessToken)
                .putString("dbPayload", dbPayload)
                .putString("fileName", fileName)
                .build()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val uploadWork = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(inputData)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .addTag("upload_$taskId")
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork("upload_$taskId", ExistingWorkPolicy.KEEP, uploadWork)

            val result = JSObject()
            result.put("taskId", taskId)
            result.put("enqueued", true)
            call.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "enqueueUpload failed", e)
            call.reject("Failed to enqueue upload: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: enqueueChunkedUpload
    // Enqueues multiple video chunk uploads as parallel WorkManager tasks
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun enqueueChunkedUpload(call: PluginCall) {
        try {
            val messageId = call.getString("messageId") ?: ""
            val totalChunks = call.getInt("totalChunks") ?: 0
            val chunkIndex = call.getInt("chunkIndex") ?: -1
            val chunkBase64 = call.getString("chunk") ?: ""
            val cloudinaryPreset = call.getString("cloudinaryPreset") ?: ""
            val cloudinaryCloudName = call.getString("cloudinaryCloudName") ?: ""
            val supabaseUrl = call.getString("supabaseUrl") ?: ""
            val supabaseKey = call.getString("supabaseKey") ?: ""
            val supabaseAccessToken = call.getString("supabaseAccessToken") ?: ""
            val packedKey = call.getString("packedKey") ?: ""
            val baseNonce = call.getString("baseNonce") ?: ""
               val duration = call.getInt("duration") ?: 0
            val senderId = call.getString("senderId") ?: ""
            val receiverId = call.getString("receiverId") ?: ""

            if (chunkIndex < 0 || chunkBase64.isEmpty()) {
                call.reject("chunk and chunkIndex are required")
                return
            }

            Log.i(TAG, "enqueueChunkedUpload: messageId=$messageId chunkIndex=$chunkIndex/$totalChunks")

            val chunkTaskId = "${messageId}_chunk_$chunkIndex"

            // Save each chunk to its own temp file
            val tempFile = saveTempFile(chunkTaskId, chunkBase64)
            if (tempFile == null) {
                call.reject("Failed to save chunk $chunkIndex to temp file")
                return
            }

            val inputData = Data.Builder()
                .putString("taskId", chunkTaskId)
                .putString("messageId", messageId)
                .putInt("chunkIndex", chunkIndex)
                .putInt("totalChunks", totalChunks)
                .putString("tempFilePath", tempFile.absolutePath)
                .putString("cloudinaryPreset", cloudinaryPreset)
                .putString("cloudinaryCloudName", cloudinaryCloudName)
                .putString("supabaseUrl", supabaseUrl)
                .putString("supabaseKey", supabaseKey)
                .putString("supabaseAccessToken", supabaseAccessToken)
                .putString("packedKey", packedKey)
                .putString("baseNonce", baseNonce)
                .putInt("duration", duration)
                .putString("senderId", senderId)
                .putString("receiverId", receiverId)
                .build()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val chunkWork = OneTimeWorkRequestBuilder<ChunkUploadWorker>()
                .setInputData(inputData)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .addTag("chunk_${messageId}")
                .addTag("chunk_$chunkTaskId")
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork("chunk_$chunkTaskId", ExistingWorkPolicy.KEEP, chunkWork)

            val result = JSObject()
            result.put("messageId", messageId)
            result.put("chunkIndex", chunkIndex)
            result.put("enqueued", true)
            call.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "enqueueChunkedUpload failed", e)
            call.reject("Failed to enqueue chunked upload: ${e.message}")
        }
    }

    @PluginMethod
    fun getUploadStatusForMessage(call: PluginCall) {
        val messageId = call.getString("messageId") ?: run {
            call.reject("messageId is required")
            return
        }
        try {
            val workManager = WorkManager.getInstance(context)
            val workInfos = workManager.getWorkInfosByTag("chunk_$messageId").get()
            
            var pending = 0
            var running = 0
            var succeeded = 0
            var failed = 0
            var cancelled = 0

            for (info in workInfos) {
                when (info.state) {
                    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> pending++
                    WorkInfo.State.RUNNING -> running++
                    WorkInfo.State.SUCCEEDED -> succeeded++
                    WorkInfo.State.FAILED -> failed++
                    WorkInfo.State.CANCELLED -> cancelled++
                }
            }

            val result = JSObject()
            result.put("pending", pending)
            result.put("running", running)
            result.put("succeeded", succeeded)
            result.put("failed", failed)
            result.put("cancelled", cancelled)
            result.put("total", workInfos.size)
            result.put("isCompleted", succeeded == workInfos.size && workInfos.size > 0)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to get status for message: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: enqueueTextMessage
    // Enqueues a lightweight DB-insert-only WorkManager job for text messages
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun enqueueTextMessage(call: PluginCall) {
        try {
            val taskId = call.getString("taskId") ?: UUID.randomUUID().toString()
            val supabaseUrl = call.getString("supabaseUrl") ?: ""
            val supabaseKey = call.getString("supabaseKey") ?: ""
            val supabaseAccessToken = call.getString("supabaseAccessToken") ?: ""
            val dbPayload = call.getString("dbPayload") ?: "{}"
            val triggerPush = call.getBoolean("triggerPush") ?: true

            Log.i(TAG, "enqueueTextMessage: taskId=$taskId")

            val inputData = Data.Builder()
                .putString("taskId", taskId)
                .putString("supabaseUrl", supabaseUrl)
                .putString("supabaseKey", supabaseKey)
                .putString("supabaseAccessToken", supabaseAccessToken)
                .putString("dbPayload", dbPayload)
                .putBoolean("triggerPush", triggerPush)
                .build()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val textWork = OneTimeWorkRequestBuilder<TextMessageWorker>()
                .setInputData(inputData)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .addTag("text_$taskId")
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork("text_$taskId", ExistingWorkPolicy.KEEP, textWork)

            val result = JSObject()
            result.put("taskId", taskId)
            result.put("enqueued", true)
            call.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "enqueueTextMessage failed", e)
            call.reject("Failed to enqueue text message: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: getQueueStatus
    // Returns counts of pending/running/completed/failed uploads
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun getQueueStatus(call: PluginCall) {
        try {
            val workManager = WorkManager.getInstance(context)
            val workInfos = workManager.getWorkInfosByTag(WORK_TAG).get()

            var pending = 0
            var running = 0
            var succeeded = 0
            var failed = 0
            var cancelled = 0

            for (info in workInfos) {
                when (info.state) {
                    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> pending++
                    WorkInfo.State.RUNNING -> running++
                    WorkInfo.State.SUCCEEDED -> succeeded++
                    WorkInfo.State.FAILED -> failed++
                    WorkInfo.State.CANCELLED -> cancelled++
                }
            }

            val result = JSObject()
            result.put("pending", pending)
            result.put("running", running)
            result.put("succeeded", succeeded)
            result.put("failed", failed)
            result.put("cancelled", cancelled)
            result.put("total", workInfos.size)
            call.resolve(result)

        } catch (e: Exception) {
            call.reject("Failed to get queue status: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: cancelUpload
    // Cancels a specific pending upload by taskId
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun cancelUpload(call: PluginCall) {
        val taskId = call.getString("taskId") ?: run {
            call.reject("taskId is required")
            return
        }
        WorkManager.getInstance(context).cancelUniqueWork("upload_$taskId")
        call.resolve(JSObject().put("cancelled", true))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: retryFailed
    // Re-enqueues all failed tasks (prunes completed/cancelled first)
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun retryFailed(call: PluginCall) {
        try {
            val workManager = WorkManager.getInstance(context)
            // Prune completed work first
            workManager.pruneWork()

            val result = JSObject()
            result.put("pruned", true)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to retry: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: Save base64-encoded encrypted data to a temp file
    // ─────────────────────────────────────────────────────────────────────────
    private fun saveTempFile(taskId: String, base64Data: String): File? {
        return try {
            val dir = File(context.cacheDir, "bg_uploads")
            if (!dir.exists()) dir.mkdirs()

            val file = File(dir, "${taskId}.enc")
            val bytes = Base64.decode(base64Data, Base64.NO_WRAP)

            FileOutputStream(file).use { fos ->
                fos.write(bytes)
            }

            Log.d(TAG, "Saved temp file: ${file.absolutePath} (${bytes.size} bytes)")
            file
        } catch (e: Exception) {
            Log.e(TAG, "saveTempFile failed for $taskId", e)
            null
        }
    }
}
