package com.newaura.app

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * ChunkUploadWorker — Handles a single video chunk background upload.
 *
 * Each chunk gets its own WorkManager job, allowing parallel uploads
 * and independent retry. WorkManager ensures each chunk eventually
 * reaches Cloudinary + Supabase even if the app is killed mid-upload.
 *
 * Flow:
 *   1. Read encrypted chunk bytes from temp file
 *   2. Upload to Cloudinary → get chunk_url
 *   3. Insert row into video_chunks table via Supabase REST
 *   4. Clean up temp file
 */
class ChunkUploadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "ChunkUploadWorker"
    }

    override suspend fun doWork(): Result {
        val taskId = inputData.getString("taskId") ?: return Result.failure()
        val messageId = inputData.getString("messageId") ?: return Result.failure()
        val chunkIndex = inputData.getInt("chunkIndex", -1)
        val totalChunks = inputData.getInt("totalChunks", 0)
        val tempFilePath = inputData.getString("tempFilePath") ?: return Result.failure()
        val cloudinaryPreset = inputData.getString("cloudinaryPreset") ?: return Result.failure()
        val cloudinaryCloudName = inputData.getString("cloudinaryCloudName") ?: return Result.failure()
        val supabaseUrl = inputData.getString("supabaseUrl") ?: return Result.failure()
        val supabaseKey = inputData.getString("supabaseKey") ?: return Result.failure()
        val supabaseAccessToken = inputData.getString("supabaseAccessToken") ?: return Result.failure()
        val packedKey = inputData.getString("packedKey") ?: ""
        val baseNonce = inputData.getString("baseNonce") ?: ""
        val duration = inputData.getInt("duration", 0)
        val senderId = inputData.getString("senderId") ?: ""
        val receiverId = inputData.getString("receiverId") ?: ""

        if (chunkIndex < 0) return Result.failure()

        Log.i(TAG, "[$taskId] Starting chunk $chunkIndex/$totalChunks for message $messageId")

        val tempFile = File(tempFilePath)
        if (!tempFile.exists()) {
            Log.e(TAG, "[$taskId] Temp file not found: $tempFilePath")
            return Result.failure()
        }

        try {
            // ── Step 1: Upload chunk to Cloudinary ────────────────────────────
            val chunkUrl = uploadToCloudinary(tempFile, cloudinaryCloudName, cloudinaryPreset)

            if (chunkUrl == null) {
                Log.e(TAG, "[$taskId] Cloudinary chunk upload failed — will retry")
                return Result.retry()
            }

            Log.i(TAG, "[$taskId] Chunk $chunkIndex uploaded → $chunkUrl")

            // ── Step 2: Insert into video_chunks table ────────────────────────
            val chunkPayload = """
                {
                    "message_id": "$messageId",
                    "chunk_index": $chunkIndex,
                    "total_chunks": $totalChunks,
                    "chunk_url": "$chunkUrl",
                    "chunk_key": ${escapeJsonString(packedKey)},
                    "chunk_nonce": ${escapeJsonString(baseNonce)},
                    "duration": $duration,
                    "sender_id": "$senderId",
                    "receiver_id": "$receiverId"
                }
            """.trimIndent()

            val dbSuccess = insertSupabaseRow(
                supabaseUrl, supabaseKey, supabaseAccessToken, chunkPayload, "video_chunks"
            )

            if (!dbSuccess) {
                Log.e(TAG, "[$taskId] Supabase video_chunks insert failed — will retry")
                return Result.retry()
            }

            Log.i(TAG, "[$taskId] Chunk $chunkIndex/$totalChunks DB insert OK ✓")

            // ── Step 3: Clean up ──────────────────────────────────────────────
            if (tempFile.exists()) tempFile.delete()

            return Result.success(
                androidx.work.Data.Builder()
                    .putString("taskId", taskId)
                    .putString("messageId", messageId)
                    .putInt("chunkIndex", chunkIndex)
                    .putString("chunkUrl", chunkUrl)
                    .build()
            )

        } catch (e: Exception) {
            Log.e(TAG, "[$taskId] Chunk upload failed", e)
            return Result.retry()
        }
    }

    /**
     * Uploads encrypted chunk bytes to Cloudinary via multipart POST.
     */
    private fun uploadToCloudinary(
        file: File,
        cloudName: String,
        uploadPreset: String
    ): String? {
        val boundary = "----AuraChunk${UUID.randomUUID()}"
        val uploadUrl = "https://api.cloudinary.com/v1_1/$cloudName/raw/upload"

        var connection: HttpURLConnection? = null
        try {
            connection = URL(uploadUrl).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.connectTimeout = 30_000
            connection.readTimeout = 120_000

            DataOutputStream(connection.outputStream).use { dos ->
                // upload_preset
                dos.writeBytes("--$boundary\r\n")
                dos.writeBytes("Content-Disposition: form-data; name=\"upload_preset\"\r\n\r\n")
                dos.writeBytes("$uploadPreset\r\n")

                // file
                dos.writeBytes("--$boundary\r\n")
                dos.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"chunk.enc\"\r\n")
                dos.writeBytes("Content-Type: application/octet-stream\r\n\r\n")

                FileInputStream(file).use { fis ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (fis.read(buffer).also { bytesRead = it } != -1) {
                        dos.write(buffer, 0, bytesRead)
                    }
                }

                dos.writeBytes("\r\n--$boundary--\r\n")
                dos.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                val response = BufferedReader(InputStreamReader(connection.inputStream)).use { it.readText() }
                val secureUrlMatch = Regex("\"secure_url\"\\s*:\\s*\"([^\"]+)\"").find(response)
                return secureUrlMatch?.groupValues?.get(1)?.replace("\\/", "/")
            } else {
                val errorBody = try {
                    BufferedReader(InputStreamReader(connection.errorStream)).use { it.readText() }
                } catch (_: Exception) { "no error body" }
                Log.e(TAG, "Cloudinary chunk upload failed: HTTP $responseCode — $errorBody")
                return null
            }

        } catch (e: Exception) {
            Log.e(TAG, "Cloudinary chunk upload exception", e)
            return null
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Inserts a row into Supabase via REST API.
     */
    private fun insertSupabaseRow(
        supabaseUrl: String,
        supabaseKey: String,
        accessToken: String,
        jsonPayload: String,
        table: String
    ): Boolean {
        val url = "$supabaseUrl/rest/v1/$table"
        var connection: HttpURLConnection? = null

        try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("apikey", supabaseKey)
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.setRequestProperty("Prefer", "return=minimal")
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000

            DataOutputStream(connection.outputStream).use { dos ->
                dos.writeBytes(jsonPayload)
                dos.flush()
            }

            val responseCode = connection.responseCode
            if (responseCode in 200..299) {
                return true
            } else {
                val errorBody = try {
                    BufferedReader(InputStreamReader(connection.errorStream)).use { it.readText() }
                } catch (_: Exception) { "no error body" }
                Log.e(TAG, "Supabase insert failed: HTTP $responseCode — $errorBody")
                return false
            }

        } catch (e: Exception) {
            Log.e(TAG, "Supabase insert exception", e)
            return false
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Escapes a string for safe JSON embedding.
     */
    private fun escapeJsonString(value: String): String {
        val escaped = value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
        return "\"$escaped\""
    }
}
