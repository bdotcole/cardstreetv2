import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cardstreet.tcg',
  appName: 'CardStreet',
  webDir: 'out',

  // Marks every WebView request as coming from the native app so middleware
  // always serves the mobile experience. Without this, WebView user-agents
  // can read as desktop (iPad WKWebViews report as Mac) and the app would get
  // the desktop site. middleware.ts matches this exact string.
  appendUserAgent: 'CardStreetApp',

  // Native web view background — prevents a white flash between the splash
  // screen hiding and the remote site (cardstreet.app) painting.
  backgroundColor: '#0f1419',

  // Load the live Vercel deployment instead of bundled static files.
  // This works because the Next.js app has API routes that require a server.
  // Remove this block to load from bundled static files (if you switch to static export later).
  server: {
    url: 'https://cardstreet.app',
    cleartext: true,
    androidScheme: 'https'
  },

  // Native plugin config
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f1419', // brand-darker
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',        // Light text on dark bg
      overlaysWebView: true,
    },
  },
};

export default config;
