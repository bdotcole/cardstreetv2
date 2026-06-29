package com.cardstreet.tcg;

import android.os.Bundle;

import com.facebook.appevents.AppEventsConstants;
import com.facebook.appevents.AppEventsLogger;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.math.BigDecimal;
import java.util.Currency;
import java.util.Iterator;

/**
 * Capacitor bridge that lets the (remote-loaded) web app log Meta app events
 * through the native Facebook Android SDK. The web layer calls this via
 * {@code registerPlugin('FacebookAppEvents')} (see lib/metaEvents.ts) only when
 * running inside the native app, so the same conversion the Pixel records on
 * web also registers as a true Android app event for App Promotion attribution
 * and shows in Meta's App Event Tester.
 *
 * This is the Android counterpart of ios/App/App/FacebookAppEventsPlugin.swift;
 * keep the two in sync. Unlike iOS (Obj-C runtime auto-discovery), this plugin
 * is registered explicitly in MainActivity.onCreate.
 */
@CapacitorPlugin(name = "FacebookAppEvents")
public class FacebookAppEventsPlugin extends Plugin {

    @PluginMethod
    public void logEvent(PluginCall call) {
        String name = call.getString("eventName");
        if (name == null || name.isEmpty()) {
            call.reject("eventName is required");
            return;
        }

        // Analytics must never break the app: any SDK failure is swallowed and
        // the call still resolves (the web Pixel has already captured the event).
        try {
            AppEventsLogger logger = AppEventsLogger.newLogger(getContext());
            Double valueToSum = call.getDouble("valueToSum");
            String currency = call.getString("currency");
            Bundle params = toBundle(call.getObject("params"));

            if (isPurchase(name) && valueToSum != null) {
                // Purchase has a dedicated SDK method so it maps to
                // fb_mobile_purchase with the currency carried separately.
                logger.logPurchase(BigDecimal.valueOf(valueToSum), currencyOrDefault(currency), params);
            } else if (valueToSum != null) {
                logger.logEvent(standardName(name), valueToSum, params);
            } else {
                logger.logEvent(standardName(name), params);
            }
        } catch (Exception ignored) {
            // Plugin/SDK unavailable or bad input - ignore.
        }

        call.resolve();
    }

    private boolean isPurchase(String name) {
        return "Purchase".equals(name) || "fb_mobile_purchase".equals(name);
    }

    private Currency currencyOrDefault(String code) {
        try {
            return Currency.getInstance(code != null ? code : "USD");
        } catch (IllegalArgumentException e) {
            return Currency.getInstance("USD");
        }
    }

    /**
     * Map web Pixel event names to the SDK's standard app-event names so they
     * register as recognized events. Unknown names pass through as custom.
     */
    private String standardName(String name) {
        switch (name) {
            case "ViewContent":
            case "fb_mobile_content_view":
                return AppEventsConstants.EVENT_NAME_VIEWED_CONTENT;
            case "Search":
            case "fb_mobile_search":
                return AppEventsConstants.EVENT_NAME_SEARCHED;
            case "AddToCart":
            case "fb_mobile_add_to_cart":
                return AppEventsConstants.EVENT_NAME_ADDED_TO_CART;
            case "AddToWishlist":
            case "fb_mobile_add_to_wishlist":
                return AppEventsConstants.EVENT_NAME_ADDED_TO_WISHLIST;
            case "InitiateCheckout":
            case "fb_mobile_initiated_checkout":
                return AppEventsConstants.EVENT_NAME_INITIATED_CHECKOUT;
            case "Purchase":
            case "fb_mobile_purchase":
                return AppEventsConstants.EVENT_NAME_PURCHASED;
            case "CompleteRegistration":
            case "fb_mobile_complete_registration":
                return AppEventsConstants.EVENT_NAME_COMPLETED_REGISTRATION;
            default:
                return name;
        }
    }

    /**
     * Convert the JS params object into a Bundle. The web layer already sends
     * SDK-native keys (fb_currency, fb_content_type, fb_content_id, ...), so
     * keys pass straight through; only value types are normalized.
     */
    private Bundle toBundle(JSObject params) {
        Bundle bundle = new Bundle();
        if (params == null) {
            return bundle;
        }
        Iterator<String> keys = params.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = params.opt(key);
            if (value == null) {
                continue;
            }
            if (value instanceof Integer) {
                bundle.putInt(key, (Integer) value);
            } else if (value instanceof Number) {
                bundle.putDouble(key, ((Number) value).doubleValue());
            } else {
                bundle.putString(key, value.toString());
            }
        }
        return bundle;
    }
}
