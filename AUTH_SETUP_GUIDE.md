# Authentication Setup Guide (Day 3)

To enable users to log in with LINE and Google, you need to configure the provider developer consoles.

## 1. LINE Login (Priority for Thailand) 🇹🇭

**Why:** Most Thai users prefer logging in with LINE.

1.  **Register a Provider:**
    *   Go to [LINE Developers Console](https://developers.line.biz/console/).
    *   Log in with your LINE account.
    *   Click **Create a new provider** and name it `CardStreet`.

2.  **Create a Channel:**
    *   Click **Create a LINE Login channel**.
    *   **Channel Type:** LINE Login.
    *   **Provider:** CardStreet.
    *   **Region:** Thailand.
    *   **Channel Name:** CardStreet TCG.
    *   **Channel Description:** Thai Pokémon Card Marketplace.
    *   **App Type:** Web app.
    *   **Email:** Your email.
    *   Accept terms and create.

3.  **Configure Callback URL:**
    *   In your new Channel, go to the **Line Login** tab.
    *   Find **Callback URL** and click Edit.
    *   **IMPORTANT:** You need your Supabase Project URL from the dashboard.
    *   Add this URL: `https://[YOUR_SUPABASE_PROJECT_ID].supabase.co/auth/v1/callback`
    *   *(Replace `[YOUR_SUPABASE_PROJECT_ID]` with the `fdxgzdd...` part from your `.env.local`)*

4.  **Get Credentials:**
    *   Go to the **Basic settings** tab.
    *   Copy **Channel ID** and **Channel Secret**.

5.  **Add to Supabase:**
    *   Go to Supabase Dashboard -> **Authentication** -> **Providers**.
    *   Select **LINE**.
    *   Enable it.
    *   Paste the **Channel ID** and **Channel Secret**.
    *   Click **Save**.

---

## 2. Google OAuth 🌍

1.  **Create Project:**
    *   Go to [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project named `CardStreet`.

2.  **Configure OAuth Screen:**
    *   Go to **APIs & Services** -> **OAuth consent screen**.
    *   Select **External** (unless you have a Google Workspace organization).
    *   Fill in App Name (`CardStreet`), User Support Email, and Developer Contact Info.
    *   Save & Continue through Scopes (default is fine).

3.  **Create Credentials:**
    *   Go to **Credentials**.
    *   Click **Create Credentials** -> **OAuth client ID**.
    *   **Application type:** Web application.
    *   **Name:** `CardStreet Web`.
    *   **Authorized redirect URIs:**
        *   `https://[YOUR_SUPABASE_PROJECT_ID].supabase.co/auth/v1/callback`
    *   Click **Create**.

4.  **Add to Supabase:**
    *   Copy **Client ID** and **Client Secret**.
    *   Go to Supabase Dashboard -> **Authentication** -> **Providers**.
    *   Select **Google**.
    *   Enable it.
    *   Paste the keys.
    *   Click **Save**.

---

## 3. Redirect Allow List (Critical)

In Supabase Dashboard -> **Authentication** -> **URL Configuration**:
*   Add your deployed Vercel URL: `https://cardstreet-tcg.vercel.app`
*   Add your local dev URL: `http://localhost:3000` (and `http://localhost:3002` just in case)
*   Supabase needs to know these are safe to redirect users back to after login.

Once you have completed these steps, users will be able to click "Login with LINE" and it will actually work!
