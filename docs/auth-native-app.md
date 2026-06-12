# Native App Auth Guide

The Desktop Agent must perform user authentication as a native app using an external system browser, rather than using an embedded webview.

## Current MVP Browser-Polling Flow

The current MVP uses an external system browser plus a short-lived polling request. This keeps email and password entry outside the Tauri webview while the production OIDC flow is still pending.

```text
Desktop Agent
  -> requests POST /api/auth/native/start
  -> receives loginUrl and pollToken
  -> opens loginUrl in the external system browser
  -> user signs in or registers in the backend-hosted browser page
  -> backend stores the completed native auth request in PostgreSQL
  -> Desktop Agent polls POST /api/auth/native/poll with pollToken
  -> backend returns a short-lived session token
  -> Desktop Agent focuses the main window and opens the authenticated workspace
  -> Desktop Agent uses the session token for API calls
```

MVP rules:

- The desktop webview must not render the password form.
- The password is submitted only to the backend-hosted external browser page.
- `pollToken` and `state` are opaque random values and must not be logged.
- The backend stores only password hashes, token hashes, and session metadata.
- The polling request is single-use: after a successful poll, the native auth request becomes consumed.
- The browser completion page must not display the account email or ask the user to manually return to the app. It may attempt an automatic return through a configured `AUTH_NATIVE_RETURN_URL`, but no token, password, or polling material may be placed in that URL.
- The Desktop Agent owns the authenticated workspace transition. Browser return URLs are focus/navigation helpers only.
- This flow is suitable for local MVP validation, not the final enterprise identity design.

## Required Authentication Flow

The production target is OIDC Authorization Code + PKCE with either a deep-link callback or a loopback callback.

```text
Desktop Agent
  -> opens external system browser
  -> Redirects to OIDC Authorization Code + PKCE
  -> Handles Deep Link or Loopback Callback
  -> Performs Token Exchange on the backend
  -> Persists tokens in secure OS storage
  -> Initializes Agent Enrollment / Session
```

## Security Rules

- **Authorization Code + PKCE:** Mandated for all user authentications.
- **Resource Owner Password Credentials Flow:** Strictly forbidden.
- **Embedded Webviews (WKWebView / WebView2):** Strictly forbidden for hosting authentication screens.
- **Token Security:** Store OAuth Refresh tokens strictly within the OS keyring or secure Tauri Stronghold vault.
- **Short-Lived Access Tokens:** Configure client access tokens with short lifetimes.
- **Logout Sequence:** Triggering logout must immediately delete all local keys, purge cached tokens, and terminate the remote session on the backend.

## Deep Link Callback

- Use a unique, custom URL scheme registered to the operating system.
- The callback handler must validate the incoming cryptographic `state` parameter.
- Store the PKCE `code_verifier` strictly within short-lived, local private memory.
- Prevent duplicate callback runs from initializing duplicate sessions.
- **Single-Instance Handling:** Implement the Tauri single-instance plugin to route deep-link callbacks to the already running agent process.

## Loopback Interface Callback

A loopback redirect interface may be used as a fallback path:

- Bind exclusively to the local loopback interface (`127.0.0.1` or `[::1]`).
- Request a randomized, ephemeral local port.
- Enforce short callback timeouts.
- Run complete `state` parameter validations.
- Terminate the local loopback listener immediately after receiving the OAuth code.

## Device & Agent Enrollment

Agent enrollment (machine provisioning) is strictly separated from user session authentication.

The Enrollment sequence requires:
- A secure, one-time invitation code or admin-approved registration flow.
- Association of the hardware fingerprint with specific `tenantId` and `agentId` keys.
- Revocation capabilities to disable lost or compromised agents instantly.
- Explicit immutable audit logging for all enrollment actions.

## Token Refresh Strategy

- Trigger silent token refresh operations safely ahead of active expiry boundaries.
- Never swallow refresh errors silently. Raise user-visible errors if authentication fails.
- After repeated authorization failures, transition the desktop agent into an explicit degraded/offline state.
- **Never trigger infinite refresh loops.** Limit retries using a defined budget and exponential backoff parameters.

## References

- RFC 8252 OAuth 2.0 for Native Apps: https://www.rfc-editor.org/rfc/rfc8252.html
- Tauri Deep Link Plugin: https://v2.tauri.app/plugin/deep-link/
- Tauri Single Instance Plugin: https://v2.tauri.app/plugin/single-instance/
- Tauri Opener Plugin: https://v2.tauri.app/plugin/opener/
