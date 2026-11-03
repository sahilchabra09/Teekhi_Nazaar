# Turning on "Continue with Google"

The code is already wired. Google sign-in switches on as soon as the server has a Google OAuth client ID and secret. Until then the button shows an error toast, and email + password keeps working.

Takes about 10 minutes.

---

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in.
2. Top bar → project picker → **New project** → name it `IRIS` → **Create**.
3. Make sure the new project is selected in the top bar.

## 2. Set up the OAuth consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**. Newer consoles call this **Google Auth Platform** → **Branding**.
2. Click **Get started**:
   - **App name:** `IRIS`
   - **User support email:** your email
   - **Audience:** **External**
   - **Contact email:** your email
3. Save.
4. **Audience** → **Test users** → **Add users** → add the Gmail addresses of everyone who will sign in (all three of us, plus any demo laptop account).
   While the app is in *Testing* mode, **only these accounts can sign in**. That's fine for the hackathon, and you don't need Google verification.
5. **Data access / Scopes:** you don't need to add anything. Better Auth asks for `openid`, `email` and `profile`, which need no review.

## 3. Create the OAuth client

1. **APIs & Services** → **Credentials**, or **Google Auth Platform** → **Clients**.
2. **Create credentials** → **OAuth client ID**.
3. **Application type:** **Web application**. **Name:** `IRIS web`.
4. **Authorized JavaScript origins:** add
   - `http://localhost:3001` (the web app)
   - `http://localhost:3000` (the auth server)
5. **Authorized redirect URIs:** add exactly
   ```
   http://localhost:3000/api/auth/callback/google
   ```
   This is `BETTER_AUTH_URL` + `/api/auth/callback/google`. It must match **character for character**: no trailing slash, `http` not `https`, port `3000` not `3001`.
6. **Create**, then copy the **Client ID** and **Client secret**.

## 4. Give the keys to the server

Add these two lines to `apps/server/.env`. This file is git-ignored, so never commit it:

```env
GOOGLE_CLIENT_ID=1234567890-xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

Restart the server (`bun run dev`).

## 5. Test it

1. Open <http://localhost:3001/login>.
2. Click **Continue with Google** → pick a test-user account → you land on the IRIS console.

---

## When something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| `Error 400: redirect_uri_mismatch` | Redirect URI in Google doesn't exactly match | Re-check step 3.5. Copy it from the error page's "request details" if you're unsure |
| `Error 403: access_denied` / "app has not completed verification" | Your account isn't a test user | Add it under **Audience → Test users** |
| Toast says Google sign-in isn't set up | Server doesn't see the keys | Check the variable names in `apps/server/.env`, then restart the server |
| Signed in, but bounced back to `/login` | Session cookie not stored | Use `localhost` everywhere (not `127.0.0.1`), and keep `CORS_ORIGIN=http://localhost:3001` in `apps/server/.env` |

## If you deploy later or open it from another device

Each new address needs to be added in **both** places:

- Google client → **Authorized JavaScript origins** and **Authorized redirect URIs** (`https://<server-domain>/api/auth/callback/google`)
- `apps/server/.env` → `BETTER_AUTH_URL`, `CORS_ORIGIN`

Google doesn't accept private LAN IP addresses like `http://192.168.x.x` as web-client redirect URIs. For Wi-Fi-only phone sign-in, use a reachable HTTPS domain or tunnel. See Google's [web-server OAuth redirect requirements](https://developers.google.com/identity/protocols/oauth2/web-server).

## Android Google sign-in

The native **Continue with Google** button opens the external browser through the same Better Auth Google provider. Google returns to the server's existing `/api/auth/callback/google` endpoint; the server then returns to `com.iris.robot://oauth/callback`, which opens IRIS. A private PKCE verifier protects the final app exchange. There is no OTP or manual laptop-linking screen, and no Google client secret is embedded in the APK. Sign in with the **same Google email on both devices**; the API routes media using the resulting verified account ID.

For the current USB development setup, keep `BETTER_AUTH_URL=http://localhost:3000` and the existing Google redirect URI unchanged. Run:

```powershell
./.tooling/android-sdk/platform-tools/adb.exe reverse tcp:3000 tcp:3000
```

On the phone, use backend `localhost:3000`, enable local HTTP, and tap **Continue with Google**. USB forwarding makes the phone browser's localhost reach the laptop. Keep the USB connection during sign-in and API use; reconnecting USB may require running the forwarding command again. The phone and laptop still need a shared LAN for WebRTC.

Without USB, set a phone-accessible HTTPS `BETTER_AUTH_URL`, add its exact `https://<server-domain>/api/auth/callback/google` to Google Cloud, and point both app and frontend at that API. Do not change the Google redirect URI to the Android custom scheme: Google returns to Better Auth first. See [Better Auth's OAuth security model](https://better-auth.com/docs/reference/security).
