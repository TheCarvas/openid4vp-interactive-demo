# Method of Procedure (MoP)
## OpenID4VP 1.0 Verified Email — Chrome / Android Slice 1 Test

**Purpose:** Set up and execute an end-to-end test in which a web page requests a verified email through OpenID4VP 1.0 and the W3C Digital Credentials API, Chrome mediates the request to Android, and the backend cryptographically validates the returned Google `UserInfoCredential` before sign-up/sign-in.

**Scope:** Local development on Windows with a physical Android device. The application runs locally and is exposed to the phone through a temporary HTTPS tunnel.

---

## 1. Expected result

A successful first-time run looks like this:

```text
Open page
  -> "Ready"
Tap Sign in with OPENID4VP
  -> Android credential consent UI
Choose/consent to Google account information
  -> browser receives DigitalCredential
  -> backend validates presentation
  -> prefilled account-creation form is shown
Submit profile
  -> "Account created"

Repeat the flow with the same email
  -> backend finds account
  -> welcome-back message and activity-report option
```

The backend validates, at minimum:

- Google VC issuer signature using Google's published JWK set
- credential type `UserInfoCredential`
- SD-JWT disclosure hashes
- holder key-binding signature from `cnf.jwk`
- transaction nonce
- key-binding `sd_hash`
- OpenID4VP DC API audience `origin:<web-origin>`
- `email_verified === true`
- credential validity handled by JOSE JWT verification (`exp` / `nbf` when present)

---

## 2. Prerequisites

### Development PC

- Windows 10/11
- Node.js **20.19 or later**
- npm
- Internet access
- Cloudflare Tunnel (`cloudflared`) or another HTTPS tunnel

Check Node/npm:

```powershell
node --version
npm --version
```

Expected: Node `v20.19.x` or newer (Node 22 is also fine).

### Android test device

Google currently documents verified-email retrieval on:

- Android 9 / API 28 or newer
- Google Play services **25.49.x or newer**
- a supported consumer Google Account on the device
- network access during the presentation

Current Google limitations to be aware of:

- Google Workspace accounts are not supported for this credential.
- Supervised accounts are not supported.
- A consumer Google Account may use either an `@gmail.com` address or another email provider.
- For a non-Gmail address, Google verified the address when the Google Account was created but does not provide a long-term freshness guarantee; a production system should consider an additional OTP challenge.

Use an up-to-date Chrome. The web Digital Credentials API requires a secure context, therefore the phone must access the application using **HTTPS**, not a LAN `http://192.168...` URL.

---

## 3. Unpack and install the project

Unzip the package and open PowerShell in the project directory.

```powershell
cd openid4vp-interactive-demo
npm install
Copy-Item .env.example .env
```

The default `.env` settings are suitable for the test:

```text
PORT=3000
FLOW_TTL_SECONDS=300
SIGNUP_TTL_SECONDS=600
GOOGLE_VC_ISSUER=https://verifiablecredentials-pa.googleapis.com
GOOGLE_VC_JWKS=https://verifiablecredentials-pa.googleapis.com/.well-known/vc-public-jwks
DEBUG_UI_ENABLED=true
CAPTURE_CREDENTIAL_ARTIFACTS=true
```

`DEBUG_UI_ENABLED=true` exposes an `OFF` / `INFO` / `DEBUG` selector in the page. `INFO` persists the
correlated frontend/backend operation timeline. `DEBUG` adds detailed validation data.
`CAPTURE_CREDENTIAL_ARTIFACTS=true` additionally persists complete request and credential artifacts for this test environment.

---

## 4. Start the local application

Run:

```powershell
npm run dev
```

Expected console output is broadly:

```text
[API] OpenID4VP verified-email API listening on http://127.0.0.1:3000
[WEB] Local: http://localhost:5173/
```

From the PC, open:

```text
http://localhost:5173
```

On desktop Chrome the page may correctly report that `DigitalCredential` is unavailable or cannot run this mobile flow. That is not the target test. This desktop check is only confirming that the UI and API are running.

You can also verify the backend directly:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Expected:

```text
ok   : True
...
```

---

## 5. Install Cloudflare Tunnel

If `cloudflared` is not already installed:

```powershell
winget install --id Cloudflare.cloudflared
```

Restart PowerShell if the command is not immediately visible, then check:

```powershell
cloudflared --version
```

No Cloudflare account is needed for a temporary Quick Tunnel.

---

## 6. Expose the web application over HTTPS

Leave `npm run dev` running in the first PowerShell window.

In a second PowerShell window, from any directory, run:

```powershell
cloudflared tunnel --url http://localhost:5173
```

Cloudflare prints a temporary URL similar to:

```text
https://random-words.trycloudflare.com
```

Keep this terminal running.

**Important:** If you stop/restart the Quick Tunnel, you normally receive a different hostname. Reload the application using the new hostname and let it prepare a fresh OpenID4VP request. Do not reuse a request prepared for the previous origin because OpenID4VP binds the presentation to the web origin.

---

## 7. Open the test on Android Chrome

On the Android phone:

1. Open Chrome.
2. Navigate to the `https://...trycloudflare.com` URL.
3. Confirm the page shows a **Ready** status and enables **Sign in with OPENID4VP**.
4. Select `INFO` or `DEBUG`, optionally expand **Persistent test diagnostics**, and confirm the request contains:

```json
{
  "response_type": "vp_token",
  "response_mode": "dc_api",
  "dcql_query": {
    "credentials": [
      {
        "id": "user_info_query",
        "format": "dc+sd-jwt",
        "meta": {
          "vct_values": ["UserInfoCredential"]
        }
      }
    ]
  }
}
```

5. Tap **Sign in with OPENID4VP**.

The Digital Credentials API call is intentionally made directly from this click handler. The request itself was prefetched from the backend because credential presentation requires a user gesture / transient activation.

---

## 8. Credential selection and consent

Expected Android behavior:

1. Chrome passes the OpenID4VP request into Android's credential mediation layer.
2. A system sheet appears showing the account/profile information to be shared.
3. Select/confirm the eligible consumer Google Account.
4. Tap the consent action such as **Agree and Continue**.

The request includes visible claims such as `email` and `name`, as well as `email_verified`. Google notes that `email_verified` and `hd` are hidden fields in the Credential Manager UI; requesting only hidden fields can cause the request to be cancelled. This project therefore requests the complete user-info claim set used in Google's implementation example.

---

## 9. Backend verification

After consent, the browser sends only these application-level items to the backend:

```json
{
  "flow_id": "...",
  "response": {
    "vp_token": {
      "user_info_query": ["<SD-JWT+KB>"]
    }
  }
}
```

The browser does **not** decide that the email is trustworthy. The server performs that decision.

A successful verification should produce diagnostics similar to:

```json
{
  "issuer": "https://verifiablecredentials-pa.googleapis.com",
  "vct": "UserInfoCredential",
  "expectedAudience": "origin:https://random-words.trycloudflare.com",
  "nonceMatched": true,
  "emailDomain": "gmail.com"
}
```

The exact algorithms and disclosure count can vary.

---

## 10. First-time sign-up test

If `.data/accounts.json` does not already contain the returned email, the page displays **Create your account**.

Verify:

- Email is populated from the credential.
- Email is read-only.
- Email is marked **Verified**.
- Display name, first name, last name, profile picture URL, and hosted domain are pre-populated when the presentation supplies them.
- Optional job-title and company fields are available for self-asserted profile information.

Edit the name fields if desired, then tap **Complete sign-up**.

Expected result:

```text
Account created
<name>
<verified-email>
```

The demo persists the account and the successful OpenID4VP sign-in event locally in:

```text
.data/accounts.json
.data/activity.json
.data/diagnostic-traces/<trace-id>.json
```

Do not commit those files. They contain readable, unencrypted demo data. Successful activity records link to a
trace by `traceId`; failed traces remain anonymous and are accessible through the trace ID shown in the test UI.

---

## 11. Existing-account sign-in test

Open/reload the HTTPS page and repeat the credential flow using the same Google Account.

Expected result after backend validation:

```text
Welcome back, <stored account name>
We haven't seen you since <previous-sign-in-time>.
<stored account name>
<verified-email>
```

There should be **no profile confirmation step** on this run. Select **View your OPENID4VP sign-in activity** and confirm the report shows the account-creation sign-in and the current sign-in, newest first.

This proves the intended branching behavior:

```text
verified presentation
       |
       +-- email unknown -> confirm profile -> create account
       |
       +-- email known   -> sign in
```

---

## 12. Reset the demo

To repeat first-time sign-up:

```powershell
npm run reset-data
```

Then reload the page and run the presentation again.

The reset command deletes `.data/accounts.json`, `.data/activity.json`, and the `.data/diagnostic-traces` directory.
Manually clearing either array file to zero bytes is also supported and is interpreted as an empty datastore on the next request.

---

## 13. Remote-debug Chrome on the Android phone

If the browser call does not behave as expected:

1. Enable **Developer options** on Android.
2. Enable **USB debugging**.
3. Connect the phone to the PC with USB.
4. Accept the debugging authorization on the phone.
5. On desktop Chrome open:

```text
chrome://inspect/#devices
```

6. Locate the tab containing the tunnel URL and click **inspect**.

Useful places to inspect:

- Console: browser API exceptions
- Network: `/api/auth/email/request`, `/api/auth/email/verify`, and `/api/diagnostics/traces/:traceId`
- `Persistent test diagnostics` panel: correlated frontend/backend progress, exact requests, artifacts, and validation results

Avoid logging or copying real credential payloads into shared tickets or public issue trackers.

---

## 14. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `This page is not a secure context` | Phone opened HTTP | Use the HTTPS tunnel URL. |
| `DigitalCredential is not exposed` | Unsupported/outdated Chrome/device configuration | Update Chrome and Google Play services; verify on Android 9+. |
| Protocol not allowed | Browser does not expose `openid4vp-v1-unsigned` | Update Chrome; confirm you are using Android Chrome rather than an embedded browser. |
| Android says no options are available | No eligible `UserInfoCredential` currently available | Confirm a supported consumer Google Account is on the device, network is available, Play services is current, and retry later after the device has had an opportunity to provision the credential while idle. |
| Workspace account does not appear | Unsupported account type | Use a consumer Google Account. |
| `NotAllowedError` / request cancelled | User cancelled, no credential matched, or activation was lost | Prepare a new request and tap the button again; do not invoke the API automatically from a timer. |
| `Unknown or expired authentication flow` | Request older than the 5-minute default | Tap **Prepare a new request** / reload. |
| `Browser origin changed during the flow` | Tunnel hostname changed | Reload from the new HTTPS hostname and use its newly generated request. |
| `Key Binding audience mismatch` | VP was bound to another origin or stale flow | Confirm the URL in the phone matches the current tunnel and prepare a new request. |
| `Key Binding nonce does not match` | Stale/replayed response or wrong flow correlation | Start a fresh flow; do not bypass this check. |
| Google JWKS/network error on backend | PC cannot reach Google's VC JWK endpoint | Check PC DNS/firewall/proxy and Internet access. |
| `email_verified=true` not present | Credential/provider mismatch | Confirm the request VCT is `UserInfoCredential`; do not treat the email as verified. |
| UI works, but account cannot be recreated | Existing demo account remains | Run `npm run reset-data`. |

---

## 15. Test evidence checklist

Record the following for a clean test run:

- [ ] Android version
- [ ] Chrome version
- [ ] Google Play services version
- [ ] Tunnel HTTPS origin
- [ ] `/api/health` successful
- [ ] Page reports protocol ready
- [ ] Android consent UI appears
- [ ] Credential returns to browser
- [ ] Backend accepts Google issuer signature
- [ ] Nonce check passes
- [ ] `origin:` audience check passes
- [ ] Holder key-binding check passes
- [ ] `email_verified === true`
- [ ] New-account profile view appears
- [ ] Account is persisted
- [ ] Second presentation signs into the existing account

---

## 16. Slice 1 security boundary and next step

This package already performs meaningful server-side credential validation because accepting a merely decoded `email_verified` claim would give a misleading test result. It is still a **prototype**.

Deliberately deferred items include:

- signed verifier request (`openid4vp-v1-signed`)
- `expected_origins` in that signed request
- encrypted `dc_api.jwt` response
- production session store
- CSRF protection
- rate limiting / abuse protection
- durable transaction store
- audit/event store
- account recovery
- passkey enrolment after signup
- policy for non-Gmail consumer Google Accounts

For the next slice, move the request to `openid4vp-v1-signed`, then move the response to `dc_api.jwt` so the browser handles an opaque encrypted response and only the backend can decrypt the presentation.

---

## 17. Reference material

These were current when this MoP was prepared on **20 August 2026**:

- OpenID for Verifiable Presentations 1.0  
  https://openid.net/specs/openid-4-verifiable-presentations-1_0.html
- W3C Digital Credentials API  
  https://www.w3.org/TR/digital-credentials/
- Android: Retrieve a verified email using digital credentials  
  https://developer.android.com/identity/digital-credentials/email-verification
- Android: Implement email verification with the Digital Credentials API  
  https://developer.android.com/identity/digital-credentials/email-verification-implementation
- Chrome: Digital Credentials API shipped  
  https://developer.chrome.com/blog/digital-credentials-api-shipped
