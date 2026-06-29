import Foundation
import Capacitor
#if canImport(FacebookCore)
import FacebookCore
#endif

/// Capacitor bridge that lets the (remote-loaded) web app log Meta app events
/// through the native Facebook iOS SDK. The web layer calls this via
/// `registerPlugin('FacebookAppEvents')` (see lib/metaEvents.ts) only when
/// running inside the native app, so the same conversion the Pixel records on
/// web also registers as a true iOS app event for App Promotion attribution
/// and shows in Meta's App Event Tester.
@objc(FacebookAppEventsPlugin)
public class FacebookAppEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FacebookAppEventsPlugin"
    public let jsName = "FacebookAppEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise)
    ]

    @objc func logEvent(_ call: CAPPluginCall) {
        guard let name = call.getString("eventName"), !name.isEmpty else {
            call.reject("eventName is required")
            return
        }

        #if canImport(FacebookCore)
        let valueToSum = call.getDouble("valueToSum")
        let currency = call.getString("currency")

        var parameters: [AppEvents.ParameterName: Any] = [:]
        if let raw = call.getObject("params") {
            for (key, value) in raw {
                parameters[AppEvents.ParameterName(key)] = value
            }
        }

        if isPurchase(name), let amount = valueToSum {
            // Purchase has a dedicated SDK method so it maps to fb_mobile_purchase
            // with the currency carried separately (not just a parameter).
            AppEvents.shared.logPurchase(amount: amount, currency: currency ?? "USD", parameters: parameters)
        } else if let amount = valueToSum {
            AppEvents.shared.logEvent(standardName(name), valueToSum: amount, parameters: parameters)
        } else {
            AppEvents.shared.logEvent(standardName(name), parameters: parameters)
        }
        #endif

        call.resolve()
    }

    #if canImport(FacebookCore)
    private func isPurchase(_ name: String) -> Bool {
        return name == "Purchase" || name == "fb_mobile_purchase"
    }

    /// Map web Pixel event names to the SDK's standard app-event names so they
    /// register as recognized events. Unknown names pass through as custom.
    private func standardName(_ name: String) -> AppEvents.Name {
        switch name {
        case "ViewContent", "fb_mobile_content_view": return .viewedContent
        case "Search", "fb_mobile_search": return .searched
        case "AddToCart", "fb_mobile_add_to_cart": return .addedToCart
        case "AddToWishlist", "fb_mobile_add_to_wishlist": return .addedToWishlist
        case "InitiateCheckout", "fb_mobile_initiated_checkout": return .initiatedCheckout
        case "Purchase", "fb_mobile_purchase": return .purchased
        case "CompleteRegistration", "fb_mobile_complete_registration": return .completedRegistration
        default: return AppEvents.Name(name)
        }
    }
    #endif
}
