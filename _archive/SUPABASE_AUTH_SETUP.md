# Supabase Auth Configuration Guide

## Overview
This guide will help you configure Supabase Authentication to work with the new sign-up/sign-in flow.

---

## Step 1: Enable Email/Password Authentication

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: **cardstreetv2**
3. Navigate to **Authentication** → **Providers**
4. Find **Email** provider
5. **Enable** the Email provider if not already enabled
6. Configure settings:
   - ✅ **Confirm email**: Enabled (users must verify email)
   - ✅ **Secure email change**: Enabled
   - **Email templates**: Keep defaults or customize (see Step 3)

---

## Step 2: Enable Google OAuth

1. In **Authentication** → **Providers**
2. Find **Google** provider
3. Click **Enable**
4. You'll need Google OAuth credentials:

### Get Google OAuth Credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure consent screen if prompted
6. Application type: **Web application**
7. **Authorized redirect URIs**: Add your Supabase callback URL:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
   Example: `https://abcdefghijk.supabase.co/auth/v1/callback`

8. Copy the **Client ID** and **Client Secret**
9. Paste them into Supabase Google provider settings
10. **Save**

---

## Step 3: Customize Email Templates (Optional)

1. Navigate to **Authentication** → **Email Templates**
2. You can customize these templates:
   - **Confirm signup**: Sent when user creates account
   - **Magic Link**: For passwordless login (not used currently)
   - **Change Email Address**: When user updates email
   - **Reset Password**: For password recovery

### Example "Confirm Signup" Template:

```html
<h2>Welcome to CardStreet!</h2>
<p>Click the link below to verify your email address:</p>
<p><a href="{{ .ConfirmationURL }}">Verify Email</a></p>
<p>This link expires in 24 hours.</p>
```

---

## Step 4: Configure Redirect URLs

1. Navigate to **Authentication** → **URL Configuration**
2. Add your allowed redirect URLs:
   - **Development**: `http://localhost:3000/api/auth/callback`
   - **Production**: `https://your-domain.com/api/auth/callback`

Example for Vercel:
```
https://cardstreet-tcg.vercel.app/api/auth/callback
```

---

## Step 5: Test the Flow

### Test Sign-Up:
1. Open your app (locally or deployed)
2. Click **"Create Account"**
3. Fill in the form:
   - Full Name
   - Email
   - Phone (optional)
   - Password (min 6 characters)
4. Click **"Create Account"**
5. Check your email for verification link
6. Click the link to verify
7. You should be redirected and signed in!

### Test Google OAuth:
1. Click **"Continue with Google"**
2. Select your Google account
3. Grant permissions
4. You should be redirected and signed in!

### Test Sign-In:
1. If already have an account, click **"Already have an account? Sign in"**
2. Switch to **Sign In** tab
3. Enter email and password
4. Click **"Sign In"**

---

## Step 6: Verify Database Integration

After a user signs up, verify that:

1. **User appears in Authentication → Users**
2. **Profile created** in `profiles` table:
   ```sql
   SELECT * FROM profiles WHERE id = '<user-id>';
   ```
3. **Settings created** in `user_settings` table:
   ```sql
   SELECT * FROM user_settings WHERE user_id = '<user-id>';
   ```

These should be created automatically by the trigger in your migrations!

---

## Optional: Phone SMS Verification

If you want to enable phone number verification via SMS:

1. Navigate to **Authentication** → **Providers**
2. Find **Phone** provider
3. Enable it
4. Choose SMS provider:
   - **Twilio** (recommended)
   - **MessageBird**
   - **Textlocal**
   - **Vonage**

5. Add your provider credentials
6. Update AuthModal.tsx to add phone signin option

---

## Troubleshooting

### Issue: "Email not confirmed" error
- **Cause**: User hasn't clicked verification link
- **Fix**: Resend verification email or disable email confirmation temporarily

### Issue: Google OAuth redirect error
- **Cause**: Redirect URL mismatch
- **Fix**: Ensure redirect URLs match exactly in both Google Console and Supabase

### Issue: User not created in database
- **Cause**: Trigger not running
- **Fix**: Check that `20260124_initial_schema.sql` migration was applied

### Issue: CORS error
- **Cause**: Domain not allowed
- **Fix**: Add domain to allowed redirect URLs in Supabase settings

---

## Current Status

✅ **Frontend Ready**:
- AuthModal with sign-up/sign-in forms
- Email/password fields
- Google OAuth button
- Email verification messaging
- Profile.tsx updated (no more "Access Terminal")

⏳ **Needs Configuration** (in Supabase Dashboard):
- Enable Email provider
- Enable Google OAuth provider
- Add Google credentials
- Configure redirect URLs

---

## Next Steps

After configuring Supabase Auth:

1. **Test thoroughly** on localhost
2. **Deploy to Vercel** (if not already)
3. **Update production redirect URLs**
4. **Invite beta testers!**

The authentication system is now production-ready once Supabase is configured! 🎉
