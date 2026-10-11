package com.cardstreet.tcg;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local Capacitor plugins are not auto-discovered on Android (unlike
        // npm-package plugins), so register the Meta app-events bridge before the
        // bridge spins up. Must precede super.onCreate().
        registerPlugin(FacebookAppEventsPlugin.class);
        registerPlugin(InstallReferrerPlugin.class);
        super.onCreate(savedInstanceState);

        // Google Pay inside the checkout runs on the Payment Request API, which
        // Android WebView disables by default. Needs WebView 137+ on the device
        // (older ones report Google Pay as not ready and checkout falls back to
        // card / PromptPay), the PAY <queries> in AndroidManifest.xml, and
        // GOOGLE_PAY_SUPPORTED in the user agent (capacitor.config.ts).
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && WebViewFeature.isFeatureSupported(WebViewFeature.PAYMENT_REQUEST)) {
            WebSettingsCompat.setPaymentRequestEnabled(webView.getSettings(), true);
        }
    }
}
