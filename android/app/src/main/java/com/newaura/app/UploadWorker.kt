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
 * UploadWorker — Handles background media uploads to Cloudinary + DB insert.
 *
 * Runs as a WorkManager CoroutineWorker, surviving app kills.
 * Flow:
 *   1. Read encrypted bytes from temp file
 *   2. Multipart upload to Cloudinary → get secure_url
 *   3. Update the dbPayload with the Cloudinary URL
 *   4. POST to Supabase REST API → insert messages row
 *   5. Clean up temp file
 *
 * No plaintext data is ever processed — only encrypted ciphertext.
 */
class UploadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "UploadWorker"
    }

    override suspend fun doWork(): Result {
        val taskId = inputData.getString("taskId") ?: return Result.failure()
        val tempFilePath = inputData.getString("tempFilePath") ?: return Result.failure()
        val cloudinaryPreset = inputData.getString("cloudinaryPreset") ?: return Result.failure()
        val cloudinaryCloudName = inputData.getString("cloudinaryCloudName") ?: return Result.failure()
        val uploadType = inputData.getString("uploadType") ?: "raw"
        val supabaseUrl = inputData.getString("supabaseUrl") ?: return Result.failure()
        val supabaseKey = inputData.getString("supabaseKey") ?: return Result.failure()
        val supabaseAccessToken = inputData.getString("supabaseAccessToken") ?: return Result.failure()
        val dbPayload = inputData.getString("dbPayload") ?: return Result.failure()
        val fileName = inputData.getString("fileName") ?: "encrypted_file.raw"

        Log.i(TAG, "[$taskId] Starting upload work...")

        val tempFile = File(tempFilePath)
        if (!tempFile.exists()) {
            Log.e(TAG, "[$taskId] Temp file not found: $tempFilePath")
            return Result.failure()
        }

        try {
            // ── Step 1: Upload to Cloudinary ──────────────────────────────────
            val secureUrl = uploadToCloudinary(
                tempFile, cloudinaryCloudName, cloudinaryPreset, uploadType, fileName
            )

            if (secureUrl == null) {
                Log.e(TAG, "[$taskId] Cloudinary upload failed — will retry")
                return Result.retry()
            }

            Log.i(TAG, "[$taskId] Cloudinary upload OK → $secureUrl")

            // ── Step 2: Insert DB row into Supabase ───────────────────────────
            // Replace the placeholder URL in the payload with the actual Cloudinary URL
            val finalPayload = dbPayload.replace("__CLOUDINARY_URL_PLACEHOLDER__", secureUrl)

            val dbSuccess = insertSupabaseRow(
                supabaseUrl, supabaseKey, supabaseAccessToken, finalPayload, "messages"
            )

            if (!dbSuccess) {
                Log.e(TAG, "[$taskId] Supabase insert failed — will retry")
                return Result.retry()
            }

            Log.i(TAG, "[$taskId] Supabase insert OK ✓")

            // ── Step 3: Clean up temp file ────────────────────────────────────
            if (tempFile.exists()) {
                tempFile.delete()
                Log.d(TAG, "[$taskId] Temp file cleaned up")
            }

            Log.i(TAG, "[$taskId] Upload work COMPLETE ✓")
            return Result.success(
                androidx.work.Data.Builder()
                    .putString("taskId", taskId)
                    .putString("secureUrl", secureUrl)
                    .build()
            )

        } catch (e: Exception) {
            Log.e(TAG, "[$taskId] Upload work failed with exception", e)
            // Retry on transient errors (max 3 retries handled by WorkManager)
            return Result.retry()
        }
    }

    /**
     * Uploads encrypted bytes to Cloudinary via multipart/form-data POST.
     * Uses HttpURLConnection (no external deps).
     *
     * @return The secure_url from Cloudinary response, or null on failure.
     */
    private fun uploadToCloudinary(
        file: File,
        cloudName: String,
        uploadPreset: String,
        uploadType: String,
        fileName: String
    ): String? {
        val boundary = "----AuraUpload${UUID.randomUUID()}"
        val uploadUrl = "https://api.cloudinary.com/v1_1/$cloudName/$uploadType/upload"

        var connection: HttpURLConnection? = null
        try {
            connection = URL(uploadUrl).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.connectTimeout = 30_000
            connection.readTimeout = 120_000 // 2 min for large files

            DataOutputStream(connection.outputStream).use { dos ->
                // ── upload_preset field ──
                dos.writeBytes("--$boundary\r\n")
                dos.writeBytes("Content-Disposition: form-data; name=\"upload_preset\"\r\n\r\n")
                dos.writeBytes("$uploadPreset\r\n")

                // ── file field ──
                dos.writeBytes("--$boundary\r\n")
                dos.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\n")
                dos.writeBytes("Content-Type: application/octet-stream\r\n\r\n")

                // Stream file bytes (don't load entire file into memory)
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
                // Simple JSON parsing for secure_url — avoid adding org.json dependency
                val secureUrlMatch = Regex("\"secure_url\"\\s*:\\s*\"([^\"]+)\"").find(response)
                return secureUrlMatch?.groupValues?.get(1)?.replace("\\/", "/")
            } else {
                val errorBody = try {
                    BufferedReader(InputStreamReader(connection.errorStream)).use { it.readText() }
                } catch (_: Exception) { "no error body" }
                Log.e(TAG, "Cloudinary upload failed: HTTP $responseCode — $errorBody")
                return null
            }

        } catch (e: Exception) {
            Log.e(TAG, "Cloudinary upload exception", e)
            return null
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Inserts a row into a Supabase table via REST API (direct HTTP POST).
     * Uses the user's access token for RLS compliance.
     *
     * @return true on success, false on failure.
     */
    internal fun insertSupabaseRow(
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
}
