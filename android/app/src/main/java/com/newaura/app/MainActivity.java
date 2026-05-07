package com.newaura.app;

import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Custom MainActivity that auto-grants WebView permission requests for
 * getUserMedia(). Without this override, the Chromium WebView inside
 * Capacitor will silently deny camera/microphone access even when the
 * Android runtime permission has already been granted — resulting in
 * "Camera access denied. Please enable in browser settings" errors.
 *
 * This is the standard pattern recommended by the Android WebView docs
 * for apps that embed a WebView and need to support WebRTC/getUserMedia.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Override the WebChromeClient to auto-grant WebView permission requests
        // using BridgeWebChromeClient to ensure Capacitor plugins don't break.
        this.bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Auto-grant all WebView resource requests (camera, microphone)
                // Security is handled at the Android runtime permission level.
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }
}
