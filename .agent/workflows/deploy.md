---
description: Deploy the app to Vercel production
---

# Deploy to Vercel

Always deploy changes to Vercel after making code changes so the live app and Android emulator reflect the latest code.

// turbo-all

1. Build the project to verify no errors:
```
cmd /c "npx next build 2>&1"
```

2. Deploy to Vercel production:
```
cmd /c "npx vercel --prod --yes 2>&1"
```

3. After deploy completes, the live URL is: https://cardstreet-tcg.vercel.app
   - The Android emulator loads from this URL via Capacitor's `server.url` config
   - Refresh the emulator app or re-run from Android Studio to see updated changes
