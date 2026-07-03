package com.cardstreet.tcg;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exposes the Play Install Referrer to the (remote-loaded) web app. When a
 * partner QR code routes an Android phone through /join/[slug], the Play
 * Store link carries referrer=utm_source=partner&utm_content=[slug]; after
 * install, the web layer (lib/installReferrer.ts) reads it back through this
 * plugin and posts it to /api/referrals/install so the partner gets download
 * credit. iOS has no equivalent API — iPhones are credited at scan time via
 * the store_visit proxy instead.
 *
 * Like FacebookAppEventsPlugin, this must be registered explicitly in
 * MainActivity.onCreate (app-local plugins are not auto-discovered).
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getReferrer(PluginCall call) {
        final InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    JSObject result = new JSObject();
                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails details = client.getInstallReferrer();
                            result.put("referrer", details.getInstallReferrer());
                        }
                    } catch (Exception ignored) {
                        // Sideloaded build, old Play Store, dead service — the
                        // web layer treats a missing referrer as "nothing to
                        // credit" and will retry on a later launch.
                    } finally {
                        try {
                            client.endConnection();
                        } catch (Exception ignored) {
                        }
                    }
                    call.resolve(result);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    // Transient loss before setup finished; the web layer's
                    // next-launch retry covers it.
                }
            });
        } catch (Exception e) {
            try {
                client.endConnection();
            } catch (Exception ignored) {
            }
            call.resolve(new JSObject());
        }
    }
}
