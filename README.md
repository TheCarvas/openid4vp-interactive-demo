# OPENID4VP 1.0 Demo

A landing page for testing an end-to-end OpenID for Verifiable Presentations (OpenID4VP) sign-in and claim-verification flow, including the relying-party user experience. This is the first release of the demo and currently supports one presentation scenario: a Google-verified email credential.

The flow is:

1. Page prepares an OpenID4VP request and nonce on the backend.
2. User taps **Sign in with OPENID4VP**.
3. Chrome on Android calls the W3C Digital Credentials API.
4. Android Credential Manager offers an eligible verified-email credential.
5. The browser forwards `DigitalCredential.data` to the backend.
6. The backend verifies the Google `UserInfoCredential` SD-JWT presentation.
7. An unknown email gets a prefilled account-creation form; a known account gets a welcome-back view with its previous sign-in time and an optional activity report.

When the Digital Credentials API is unavailable, the browser rejects the configured protocol, or
`navigator.credentials.get()` rejects, the page exposes an explicit **Use sample credential** action.
The fallback is never selected automatically, and the demo ships no sample credential of its own.
The operator uploads a captured context/response pair in the fallback panel, the backend verifies it
for that one request, then the flow enters the same profile-confirmation or sign-in path as a live
credential.

The request deliberately uses the simplest OpenID4VP 1.0 DC API profile:

- protocol: `openid4vp-v1-unsigned`
- response mode: `dc_api`
- format: `dc+sd-jwt`
- VCT: `UserInfoCredential`
- claims: `email`, `email_verified`, `name`, `given_name`, `family_name`, `picture`, `hd`

## Architecture

```text
Vite page (HTTPS origin)
   |  POST /api/auth/email/request { protocol, claims }
   v
Express backend -> nonce + DCQL request
   |
   +-------------------------------> browser page
                                      |
                                      | user click
                                      v
                            navigator.credentials.get()
                                      |
                                      v
                              Chrome / Android
                              Credential Manager
                                      |
                                      v
                               UserInfoCredential
                                      |
                                      v
                              DigitalCredential.data
                                      |
                                      v
Express /api/auth/email/verify
   |- Google issuer signature
   |- SD-JWT disclosures
   |- holder key binding
   |- nonce
   |- sd_hash
   |- origin: audience
   |- email_verified=true
   v
account lookup -> profile confirmation OR existing-account sign-in
```

The code is organized around explicit boundaries:

```text
shared/contracts/auth.ts       runtime-validated API request/response contracts
src/                           browser UI, request configuration, fallback policy
server/index.ts                configuration and process startup
server/app.ts                  Express middleware and route composition
server/auth/routes.ts          HTTP adapter for the authentication API
server/auth/service.ts         shared live/sample account-flow orchestration
server/auth/transaction-store.ts
                               short-lived flow and signup transactions
server/accounts/               account repository interface and JSON implementation
server/activity/               sign-in activity repository interface and JSON implementation
server/diagnostics/            persistent correlated FE/BE diagnostic traces and API
server/openid4vp/request.ts     OpenID4VP request construction
server/openid4vp/verifier.ts    live and sample verification policies
server/openid4vp/sample-fixtures.ts
                               validation of an uploaded sample credential
server/openid4vp/test-credential.ts
                               synthetic credential minting used only by tests
server/http/                   origin, cookie, and error adapters
```

### Authentication API

- `POST /api/auth/email/request` validates the selected claims and request type, then creates the complete nonce-bound DCQL request on the backend. `openid4vp-v1-signed` is represented in the API contract but rejected with a controlled response until signed-request support is implemented.
- `POST /api/auth/email/verify` accepts a live `DigitalCredential.data` response.
- `POST /api/auth/email/verify-sample` accepts the current `flow_id` plus the uploaded `context` and `response` documents. It does not accept validation flags, and the server holds no sample credential to fall back on.
- `POST /api/auth/email/signup` completes the common profile-confirmation flow.
- `GET /api/diagnostics/config` exposes the backend diagnostic capabilities to the test UI.
- `GET /api/diagnostics/traces/:traceId` returns a persisted correlated authentication trace.

Request and response shapes are defined once as Zod schemas in
[`shared/contracts/auth.ts`](shared/contracts/auth.ts) and consumed by both the browser and server.

## Demo data persistence

User and authentication activity data are stored as readable JSON for this first release:

- `.data/accounts.json` contains user profiles, the verified claims retained at registration, and the latest sign-in timestamp.
- `.data/activity.json` contains append-only OpenID4VP sign-in events and an extensible `attributes` object.
- `.data/diagnostic-traces/<traceId>.json` contains the correlated frontend/backend events for one
  authentication attempt. Successful traces reference their account and activity; failed traces remain anonymous.

The account and activity stores are accessed through repository interfaces, so the authentication service does not depend on JSON or filesystem APIs. A database-backed implementation can replace either repository in the startup composition without changing the main application flow. These files are intentionally unencrypted demo storage and must not be used for production data.

Enable the test diagnostics UI and optional full credential artifact persistence with:

```text
DEBUG_UI_ENABLED=true
CAPTURE_CREDENTIAL_ARTIFACTS=true
```

The UI selects `OFF`, `INFO`, or `DEBUG` per authentication flow. `INFO` records operation progress;
`DEBUG` adds detailed verification data and, when permitted by the second setting, complete credential artifacts.
Successful activity records contain a `traceId` link. A failed attempt is retrieved by the trace ID shown in the
browser diagnostic panel and is never assigned to a fake user.

Missing or zero-byte datastore files are treated as empty stores, so either deleting or clearing them resets the corresponding demo data. Updates are written to a temporary file and atomically replaced to avoid leaving a truncated JSON document after an interrupted write. Prefer `npm run reset-data` when resetting the account, activity, and diagnostic trace stores together.

## Sample credential fallback

The fallback appears only after a backend flow has been prepared and live browser/wallet capture is
unavailable or rejects. Click **Use sample credential** to invoke it. The UI and diagnostic output
label every result as `sample` or `live`.

### Supplying a sample credential

The panel has two required file inputs:

- **Context file** &mdash; `nonce`, `origin`, `validationTimeSeconds`, and the Ed25519 `issuerJwk`.
- **Response file** &mdash; the captured `protocol` and `data.vp_token`.

Both are parsed and schema-checked in the browser, sent with the verification request, re-validated
server-side, used for that single attempt, and then dropped. Nothing is written to disk and nothing
persists between attempts.

A captured Google credential contains the credential subject's real name, email address, and profile
photo URL. Treat these files as personal data: keep them outside the repository (`fixtures/` and
`*sample-credential*.json` are gitignored), and only upload a credential you are authorized to use.
`server/openid4vp/test-credential.ts` mints synthetic credentials for the test suite so no real
credential is ever needed to run tests.

Sample mode still verifies:

- the response protocol and `vp_token.user_info_query[0]` shape;
- the issuer JWT with the uploaded Ed25519 issuer key;
- the expected Google issuer and `UserInfoCredential` VCT;
- every SD-JWT disclosure digest;
- the holder key and Key Binding JWT signature;
- the Key Binding nonce against the captured nonce;
- the captured audience;
- `sd_hash`; and
- `email_verified=true` and the normal verified-claim extraction.

Only captured time/transaction behavior differs: sample nonce comparison uses the captured nonce,
issuer validation uses `validationTimeSeconds`, and the captured string-form Key Binding `iat` is checked
against that deterministic time. The live verifier continues to require the fresh backend nonce,
`origin:<origin>` audience, strict numeric `iat`, and current-wall-clock freshness.

This fallback is a demo/development capability and must not be used as production authentication.

## Quick start

```bash
npm install
copy .env.example .env
npm run dev
```

Then expose the Vite port over HTTPS, for example:

```bash
cloudflared tunnel --url http://localhost:5173
```

Open the generated `https://...trycloudflare.com` URL in **Chrome on the Android device** and tap **Sign in with OPENID4VP**.

For the detailed setup and test procedure, use [`docs/MOP.md`](docs/MOP.md).

## Useful commands

```bash
npm run dev          # API on 3000 + Vite on 5173
npm run check        # TypeScript check
npm run build        # Build web UI into dist/
npm test             # Contracts, verifier security cases, service, UI policy, and API integration
npm start            # API + serves dist/ when it exists
npm run reset-data   # Delete demo accounts so sign-up can be repeated
```

## What is intentionally demo-grade

The credential verification path is real, but this is not a production auth service. The verifier request is unsigned, sample fallback is intentionally replayable under a server-only fixed policy, transaction storage is in memory, account and activity storage use unencrypted local JSON files, the `demo_session` cookie is illustrative rather than backed by a durable server-side session store, and there is no CSRF protection, rate limiting, production audit infrastructure, telemetry, or recovery flow.

The next hardening step is a signed OpenID4VP request and `dc_api.jwt` encrypted response.

## Current upstream references

- OpenID4VP 1.0: https://openid.net/specs/openid-4-verifiable-presentations-1_0.html
- W3C Digital Credentials API: https://www.w3.org/TR/digital-credentials/
- Android verified-email overview: https://developer.android.com/identity/digital-credentials/email-verification
- Android verified-email implementation: https://developer.android.com/identity/digital-credentials/email-verification-implementation
- Chrome Digital Credentials API: https://developer.chrome.com/blog/digital-credentials-api-shipped
