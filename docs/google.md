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

Google doesn't accept raw IP addresses like `http://192.168.x.x` as redirect URIs, so for LAN access use a domain or a tunnel (e.g. `cloudflared`). For the hackathon, sign in on the laptop through `localhost`.
