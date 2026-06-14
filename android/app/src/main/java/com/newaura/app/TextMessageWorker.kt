package com.newaura.app

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.BufferedReader
import java.io.DataOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * TextMessageWorker — Lightweight WorkManager worker for text-only messages.
 *
 * Ensures that the Supabase DB insert for a text message completes
 * even if the user closes the app immediately after pressing Send.
 *
 * Optionally triggers the `send-push` edge function after insert.
 *
 * Flow:
 *   1. POST the already-encrypted message payload to Supabase REST API
 *   2. (Optional) Invoke send-push edge function for push notifications
 *   3. Report success/failure
 */
class TextMessageWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "TextMessageWorker"
    }

    override suspend fun doWork(): Result {
        val taskId = inputData.getString("taskId") ?: return Result.failure()
        val supabaseUrl = inputData.getString("supabaseUrl") ?: return Result.failure()
        val supabaseKey = inputData.getString("supabaseKey") ?: return Result.failure()
        val supabaseAccessToken = inputData.getString("supabaseAccessToken") ?: return Result.failure()
        val dbPayload = inputData.getString("dbPayload") ?: return Result.failure()
        val triggerPush = inputData.getBoolean("triggerPush", true)

        Log.i(TAG, "[$taskId] Starting text message work...")

        try {
            // ── Step 1: Insert message into Supabase ──────────────────────────
            val success = insertSupabaseRow(supabaseUrl, supabaseKey, supabaseAccessToken, dbPayload)

            if (!success) {
                Log.e(TAG, "[$taskId] Supabase insert failed — will retry")
                return Result.retry()
            }

            Log.i(TAG, "[$taskId] Text message DB insert OK ✓")

            // ── Step 2: Trigger push notification (best-effort) ───────────────
            if (triggerPush) {
                try {
                    triggerPushNotification(supabaseUrl, supabaseKey, supabaseAccessToken, dbPayload)
                } catch (e: Exception) {
                    // Push is best-effort — don't fail the work if push fails
                    Log.w(TAG, "[$taskId] Push notification trigger failed (non-fatal): ${e.message}")
                }
            }

            return Result.success(
                androidx.work.Data.Builder()
                    .putString("taskId", taskId)
                    .build()
            )

        } catch (e: Exception) {
            Log.e(TAG, "[$taskId] Text message work failed", e)
            return Result.retry()
        }
    }

    /**
     * Insert message row via Supabase REST API.
     */
    private fun insertSupabaseRow(
        supabaseUrl: String,
        supabaseKey: String,
        accessToken: String,
        jsonPayload: String
    ): Boolean {
        val url = "$supabaseUrl/rest/v1/messages"
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
     * Trigger push notification via Supabase Edge Function (best-effort).
     * Extracts sender_id and receiver_id from the dbPayload to build the push request.
     */
    private fun triggerPushNotification(
        supabaseUrl: String,
        supabaseKey: String,
        accessToken: String,
        dbPayload: String
    ) {
        // Extract IDs from payload using simple regex
        val idRegex = Regex("\"id\"\\s*:\\s*\"([^\"]+)\"")
        val senderRegex = Regex("\"sender_id\"\\s*:\\s*\"([^\"]+)\"")
        val receiverRegex = Regex("\"receiver_id\"\\s*:\\s*\"([^\"]+)\"")

        val msgId = idRegex.find(dbPayload)?.groupValues?.get(1) ?: return
        val senderId = senderRegex.find(dbPayload)?.groupValues?.get(1) ?: return
        val receiverId = receiverRegex.find(dbPayload)?.groupValues?.get(1) ?: return

        val pushPayload = """
            {"record":{"id":"$msgId","sender_id":"$senderId","receiver_id":"$receiverId"}}
        """.trim()

        val url = "$supabaseUrl/functions/v1/send-push"
        var connection: HttpURLConnection? = null

        try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("apikey", supabaseKey)
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            DataOutputStream(connection.outputStream).use { dos ->
                dos.writeBytes(pushPayload)
                dos.flush()
            }

            val responseCode = connection.responseCode
            Log.i(TAG, "Push notification trigger: HTTP $responseCode")

        } catch (e: Exception) {
            Log.w(TAG, "Push trigger exception (non-fatal): ${e.message}")
        } finally {
            connection?.disconnect()
        }
    }
}
