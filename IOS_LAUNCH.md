# CardStreet iOS launch checklist

The iOS app is the same Capacitor shell as Android: it loads `https://cardstreet.app`
and hits the same Supabase backend, so iOS and Android users share one marketplace
with no backend changes. This doc tracks the iOS-only work.

## Done in the codebase

- [x] `@capacitor/ios` installed, `npx cap add ios` scaffolded `ios/`.
- [x] Camera + photo-library usage strings added to `ios/App/App/Info.plist`
      (required — the scanner crashes without `NSCameraUsageDescription`).
- [x] `codemagic.yaml` — cloud macOS build → TestFlight (no Mac needed).

## Apple review blockers — must clear before submission

### 1. Sign in with Apple (REQUIRED)
Apple Guideline 4.8 requires Sign in with Apple because Google OAuth is offered.
- [x] "Continue with Apple" button added to `components/AuthModal.tsx`, sharing the
      generic `handleOAuthLogin('apple'|'google')` handler that reuses the native
      Capacitor deep-link path. The provider-agnostic `/auth/callback` exchanges the code.
- [ ] Supabase dashboard: enable the Apple auth provider (needs an Apple Services ID,
      Team ID, Key ID, and a private key from the Apple Developer portal). **Blocked on
      developer account approval.** Until enabled, the button returns a friendly error.
- [ ] Add the "Sign in with Apple" capability to the iOS target (entitlement) in Xcode/Codemagic.

### 2. Working in-app account deletion (REQUIRED)
Apple Guideline 5.1.1(v) requires real, in-app-reachable account deletion.
- [x] `app/api/account/delete/route.ts` — authenticated POST that calls admin
      `deleteUser` (cascades to all the user's rows), guarded so it refuses while any
      order still has `escrow_status='held'`. Signs out on success.
- [x] `app/delete/page.tsx` rewritten from the old mock: signed-in users get a
      type-DELETE confirmation that really calls the route; signed-out visitors are told
      to sign in first.
- [x] `/delete` is linked from the Profile screen (below Sign Out, non-guest only) via
      the `profile.deleteAccount` i18n key (added to en + th locales).

### 3. Push notifications via APNs / FCM
iOS push routes through APNs, and the backend addresses devices by FCM token.
- [x] Added `@capacitor-firebase/messaging` (+ `firebase`). `hooks/usePushNotifications.ts`
      now branches: Android keeps `@capacitor/push-notifications` (already an FCM token);
      iOS uses Firebase Messaging to mint a real FCM token (the bare plugin only yields the
      raw APNs token, which the FCM backend can't address). Imported dynamically so firebase
      JS is code-split off the web/Android path.
- [x] `FirebaseApp.configure()` added to `ios/App/App/AppDelegate.swift`; `GoogleService-Info.plist`
      wired into `App.xcodeproj` (file ref + Resources build phase).
- [ ] **Drop `GoogleService-Info.plist` (downloaded from Firebase) into `ios/App/App/`** and
      commit it. The build will fail until this file is present (it's referenced in the project).
- [ ] Register an iOS app in Firebase + upload the APNs `.p8` key (Firebase > Cloud Messaging).
- [x] `aps-environment` entitlement added (`ios/App/App/App.entitlements`, wired via
      `CODE_SIGN_ENTITLEMENTS` in both build configs). The App ID already has Push enabled, so
      Codemagic automatic signing will include push in the profile.
      NOTE: the entitlement value is `development`. Xcode's App Store export normally remaps
      this to `production`; if push doesn't arrive on a TestFlight build, change it to
      `production`.

## Apple account / store setup (one-time, off-codebase)

- [ ] Enroll in Apple Developer Program ($99/yr). Org enrollment needs a D-U-N-S number
      (free, ~1–2 weeks lead time) — start this first.
- [ ] Register bundle id `com.cardstreet.tcg` and create the app record in App Store Connect.
- [ ] In Codemagic: connect repo, add App Store Connect API key integration, fill in the
      placeholders in `codemagic.yaml` (integration name, numeric Apple ID).
- [ ] App Store Connect: privacy nutrition labels, privacy policy URL, screenshots.

## Payments note

Trading cards are **physical goods** shipped to buyers, so they are exempt from Apple
in-app purchase. Stripe Connect checkout is allowed and correct — do NOT add Apple IAP
(doing so would itself cause rejection). Be ready to state this in review notes.

## Minimum-functionality note (Guideline 4.2)

Apple scrutinizes thin webview wrappers that load a remote URL (this app's pattern).
Lead the review notes with the native features — camera card scanning and push
notifications — to demonstrate it's more than a wrapped website.
