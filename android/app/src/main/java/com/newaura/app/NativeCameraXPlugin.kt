package com.newaura.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.*
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.concurrent.futures.await
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * NativeCameraXPlugin — Capacitor bridge to Android CameraX + Extensions API.
 *
 * This plugin gives the React UI direct access to the device's native camera
 * hardware, including OEM-specific computational photography features:
 *   - HDR (High Dynamic Range) via CameraX Extensions
 *   - Night Mode (Night Sight / Super Night) via CameraX Extensions
 *   - Bokeh (Portrait Mode) via CameraX Extensions
 *   - Face Retouch via CameraX Extensions
 *   - Auto mode (OEM decides best processing)
 *
 * Architecture mirrors Instagram/WhatsApp approach:
 *   React UI → Capacitor Bridge → This Plugin → CameraX Extensions → OEM HAL → ISP
 *
 * The camera preview runs BEHIND the WebView (transparent background) so that
 * the existing React camera UI overlay continues to work unchanged.
 */
@CapacitorPlugin(
    name = "NativeCameraX",
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera")
    ]
)
class NativeCameraXPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeCameraX"
    }

    // ── Core CameraX objects ────────────────────────────────────────────────
    private var cameraProvider: ProcessCameraProvider? = null
    private var extensionsManager: ExtensionsManager? = null
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var preview: Preview? = null
    private var previewView: PreviewView? = null

    // ── State ───────────────────────────────────────────────────────────────
    private var currentLensFacing = CameraSelector.LENS_FACING_BACK
    private var currentExtensionMode = ExtensionMode.NONE
    private var isPreviewActive = false

    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: getSupportedExtensions
    // Returns which camera extensions (HDR, Night, Bokeh, etc.) the device supports
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun getSupportedExtensions(call: PluginCall) {
        scope.launch {
            try {
                val provider = getOrInitProvider()
                val extMgr = getOrInitExtensions(provider)

                val backSelector = CameraSelector.DEFAULT_BACK_CAMERA
                val frontSelector = CameraSelector.DEFAULT_FRONT_CAMERA

                val result = JSObject()

                // Check back camera extensions
                val backExts = JSArray()
                for ((mode, name) in extensionModes()) {
                    try {
                        if (extMgr.isExtensionAvailable(backSelector, mode)) {
                            backExts.put(name)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Extension check failed for $name on back: ${e.message}")
                    }
                }
                result.put("back", backExts)

                // Check front camera extensions
                val frontExts = JSArray()
                for ((mode, name) in extensionModes()) {
                    try {
                        if (extMgr.isExtensionAvailable(frontSelector, mode)) {
                            frontExts.put(name)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Extension check failed for $name on front: ${e.message}")
                    }
                }
                result.put("front", frontExts)

                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "getSupportedExtensions failed", e)
                call.reject("Failed to query extensions: ${e.message}")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: startPreview
    // Starts the native camera preview behind the WebView.
    // Options: { lensFacing: "BACK"|"FRONT", extensionMode: "NONE"|"HDR"|"NIGHT"|"BOKEH"|"FACE_RETOUCH"|"AUTO" }
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun startPreview(call: PluginCall) {
        val facing = call.getString("lensFacing", "BACK")
        val extMode = call.getString("extensionMode", "NONE")

        currentLensFacing = if (facing == "FRONT") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
        currentExtensionMode = parseExtensionMode(extMode ?: "NONE")

        scope.launch {
            try {
                val provider = getOrInitProvider()
                val extMgr = getOrInitExtensions(provider)

                // Unbind any existing use cases
                provider.unbindAll()

                // Build the base camera selector
                val baseSelector = CameraSelector.Builder()
                    .requireLensFacing(currentLensFacing)
                    .build()

                // Apply extension if available, otherwise fall back to NONE
                val cameraSelector = if (currentExtensionMode != ExtensionMode.NONE &&
                    extMgr.isExtensionAvailable(baseSelector, currentExtensionMode)) {
                    Log.i(TAG, "Extension ${extMode} is available — enabling")
                    extMgr.getExtensionEnabledCameraSelector(baseSelector, currentExtensionMode)
                } else {
                    if (currentExtensionMode != ExtensionMode.NONE) {
                        Log.w(TAG, "Extension ${extMode} NOT available on this device — falling back to NONE")
                    }
                    baseSelector
                }

                // Create PreviewView and add behind WebView
                activity.runOnUiThread {
                    setupPreviewView()
                }

                // Small delay to let the view attach
                delay(100)

                // Build Preview use case
                preview = Preview.Builder()
                    .setTargetResolution(Size(1920, 1080))
                    .build()
                    .also {
                        activity.runOnUiThread {
                            it.surfaceProvider = previewView?.surfaceProvider
                        }
                    }

                // Build ImageCapture use case (for high-quality photo capture)
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setTargetRotation(activity.windowManager.defaultDisplay.rotation)
                    .build()

                // Bind to lifecycle
                val lifecycleOwner = activity as? LifecycleOwner
                if (lifecycleOwner == null) {
                    call.reject("Activity is not a LifecycleOwner")
                    return@launch
                }

                camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageCapture
                )

                isPreviewActive = true

                val result = JSObject()
                result.put("started", true)
                result.put("extensionApplied", currentExtensionMode != ExtensionMode.NONE &&
                    extMgr.isExtensionAvailable(baseSelector, currentExtensionMode))
                result.put("lensFacing", facing)

                // Report zoom capabilities
                camera?.cameraInfo?.zoomState?.value?.let { zoom ->
                    val zoomInfo = JSObject()
                    zoomInfo.put("min", zoom.minZoomRatio.toDouble())
                    zoomInfo.put("max", zoom.maxZoomRatio.toDouble())
                    zoomInfo.put("current", zoom.zoomRatio.toDouble())
                    result.put("zoom", zoomInfo)
                }

                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "startPreview failed", e)
                call.reject("Failed to start preview: ${e.message}")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: stopPreview
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun stopPreview(call: PluginCall) {
        scope.launch {
            try {
                cameraProvider?.unbindAll()
                isPreviewActive = false

                activity.runOnUiThread {
                    removePreviewView()
                }

                call.resolve(JSObject().put("stopped", true))
            } catch (e: Exception) {
                call.reject("Failed to stop preview: ${e.message}")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: capturePhoto
    // Takes a full-resolution photo using the native CameraX pipeline.
    // With Extensions enabled, this photo will have HDR/Night/Bokeh processing
    // applied by the device's ISP — identical to the stock camera app quality.
    // Returns: { dataUrl: "data:image/jpeg;base64,...", width, height, format }
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun capturePhoto(call: PluginCall) {
        val capture = imageCapture
        if (capture == null) {
            call.reject("Camera not started. Call startPreview() first.")
            return
        }

        val quality = call.getInt("quality", 92) ?: 92

        capture.takePicture(cameraExecutor, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(imageProxy: ImageProxy) {
                try {
                    val buffer = imageProxy.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)

                    // Decode to bitmap for rotation correction
                    var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

                    // Apply EXIF rotation
                    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
                    if (rotationDegrees != 0) {
                        val matrix = Matrix()
                        matrix.postRotate(rotationDegrees.toFloat())
                        bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                    }

                    // Mirror for front camera
                    if (currentLensFacing == CameraSelector.LENS_FACING_FRONT) {
                        val mirrorMatrix = Matrix()
                        mirrorMatrix.preScale(-1f, 1f)
                        bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, mirrorMatrix, true)
                    }

                    // Compress to JPEG
                    val outputStream = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
                    val jpegBytes = outputStream.toByteArray()
                    val base64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)

                    val result = JSObject()
                    result.put("dataUrl", "data:image/jpeg;base64,$base64")
                    result.put("width", bitmap.width)
                    result.put("height", bitmap.height)
                    result.put("format", "jpeg")
                    result.put("sizeBytes", jpegBytes.size)

                    activity.runOnUiThread {
                        call.resolve(result)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Photo processing failed", e)
                    activity.runOnUiThread {
                        call.reject("Photo processing failed: ${e.message}")
                    }
                } finally {
                    imageProxy.close()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                Log.e(TAG, "Capture failed", exception)
                activity.runOnUiThread {
                    call.reject("Capture failed: ${exception.message}")
                }
            }
        })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: setZoom — Applies optical/hardware zoom
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun setZoom(call: PluginCall) {
        val level = call.getFloat("level", 1.0f) ?: 1.0f
        val cam = camera
        if (cam == null) {
            call.reject("Camera not started")
            return
        }

        val zoomState = cam.cameraInfo.zoomState.value
        val clamped = level.coerceIn(
            zoomState?.minZoomRatio ?: 1f,
            zoomState?.maxZoomRatio ?: level
        )

        cam.cameraControl.setZoomRatio(clamped)

        val result = JSObject()
        result.put("zoom", clamped.toDouble())
        call.resolve(result)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: setFocusPoint — Tap-to-focus at normalized coordinates (0-1)
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun setFocusPoint(call: PluginCall) {
        val x = call.getFloat("x", 0.5f) ?: 0.5f
        val y = call.getFloat("y", 0.5f) ?: 0.5f
        val cam = camera
        if (cam == null) {
            call.reject("Camera not started")
            return
        }

        val factory = previewView?.meteringPointFactory ?: run {
            call.reject("PreviewView not available")
            return
        }

        // Convert normalized coords to PreviewView pixel coords
        val pvWidth = previewView?.width?.toFloat() ?: 1f
        val pvHeight = previewView?.height?.toFloat() ?: 1f
        val point = factory.createPoint(x * pvWidth, y * pvHeight)

        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
            .setAutoCancelDuration(3, java.util.concurrent.TimeUnit.SECONDS)
            .build()

        cam.cameraControl.startFocusAndMetering(action)
        call.resolve(JSObject().put("focused", true))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: setTorch — Toggle flashlight
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun setTorch(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        val cam = camera
        if (cam == null) {
            call.reject("Camera not started")
            return
        }

        if (!cam.cameraInfo.hasFlashUnit()) {
            call.reject("No flash unit available")
            return
        }

        cam.cameraControl.enableTorch(enabled)
        call.resolve(JSObject().put("torch", enabled))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: switchExtension — Change camera mode without full restart
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun switchExtension(call: PluginCall) {
        val extMode = call.getString("extensionMode", "NONE") ?: "NONE"
        val lensFacing = call.getString("lensFacing") ?: if (currentLensFacing == CameraSelector.LENS_FACING_FRONT) "FRONT" else "BACK"

        // Delegate to startPreview with new extension — it handles unbind/rebind
        call.data.put("lensFacing", lensFacing)
        call.data.put("extensionMode", extMode)
        startPreview(call)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JS API: getCameraInfo — Device camera capabilities
    // ─────────────────────────────────────────────────────────────────────────
    @PluginMethod
    fun getCameraInfo(call: PluginCall) {
        val cam = camera
        if (cam == null) {
            call.reject("Camera not started")
            return
        }

        val result = JSObject()
        result.put("hasFlash", cam.cameraInfo.hasFlashUnit())
        result.put("isFrontFacing", currentLensFacing == CameraSelector.LENS_FACING_FRONT)

        cam.cameraInfo.zoomState.value?.let { zoom ->
            val zoomInfo = JSObject()
            zoomInfo.put("min", zoom.minZoomRatio.toDouble())
            zoomInfo.put("max", zoom.maxZoomRatio.toDouble())
            zoomInfo.put("current", zoom.zoomRatio.toDouble())
            result.put("zoom", zoomInfo)
        }

        result.put("sensorRotation", cam.cameraInfo.sensorRotationDegrees)
        call.resolve(result)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: PreviewView management
    // The PreviewView sits BEHIND the WebView so React UI overlays on top.
    // ─────────────────────────────────────────────────────────────────────────
    private fun setupPreviewView() {
        removePreviewView() // Clean up any existing preview

        previewView = PreviewView(activity).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }

        // Insert PreviewView at index 0 (behind the WebView)
        val rootView = activity.findViewById<ViewGroup>(android.R.id.content)
        rootView.addView(previewView, 0)

        // Make WebView background transparent so native preview shows through
        bridge.webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        bridge.webView.parent?.let {
            if (it is android.view.View) {
                it.setBackgroundColor(android.graphics.Color.TRANSPARENT)
            }
        }
    }

    private fun removePreviewView() {
        previewView?.let { pv ->
            val rootView = activity.findViewById<ViewGroup>(android.R.id.content)
            rootView.removeView(pv)
        }
        previewView = null

        // Restore WebView background
        bridge.webView.setBackgroundColor(android.graphics.Color.WHITE)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: CameraProvider + ExtensionsManager init
    // ─────────────────────────────────────────────────────────────────────────
    private suspend fun getOrInitProvider(): ProcessCameraProvider {
        if (cameraProvider != null) return cameraProvider!!
        val provider = ProcessCameraProvider.getInstance(activity).await()
        cameraProvider = provider
        return provider
    }

    private suspend fun getOrInitExtensions(provider: ProcessCameraProvider): ExtensionsManager {
        if (extensionsManager != null) return extensionsManager!!
        val mgr = ExtensionsManager.getInstanceAsync(activity, provider).await()
        extensionsManager = mgr
        return mgr
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: Extension mode mapping
    // ─────────────────────────────────────────────────────────────────────────
    private fun parseExtensionMode(mode: String): Int = when (mode.uppercase()) {
        "HDR" -> ExtensionMode.HDR
        "NIGHT" -> ExtensionMode.NIGHT
        "BOKEH" -> ExtensionMode.BOKEH
        "FACE_RETOUCH" -> ExtensionMode.FACE_RETOUCH
        "AUTO" -> ExtensionMode.AUTO
        else -> ExtensionMode.NONE
    }

    private fun extensionModes(): List<Pair<Int, String>> = listOf(
        ExtensionMode.HDR to "HDR",
        ExtensionMode.NIGHT to "NIGHT",
        ExtensionMode.BOKEH to "BOKEH",
        ExtensionMode.FACE_RETOUCH to "FACE_RETOUCH",
        ExtensionMode.AUTO to "AUTO"
    )

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    override fun handleOnDestroy() {
        super.handleOnDestroy()
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
        scope.cancel()
        activity.runOnUiThread { removePreviewView() }
    }
}
