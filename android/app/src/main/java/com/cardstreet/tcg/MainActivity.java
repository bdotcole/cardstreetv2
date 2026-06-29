package com.cardstreet.tcg;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local Capacitor plugins are not auto-discovered on Android (unlike
        // npm-package plugins), so register the Meta app-events bridge before the
        // bridge spins up. Must precede super.onCreate().
        registerPlugin(FacebookAppEventsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
