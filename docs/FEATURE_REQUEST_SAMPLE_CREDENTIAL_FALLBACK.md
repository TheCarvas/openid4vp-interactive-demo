# Feature Request Prompt: OpenID4VP Sample Credential Fallback

Use the following prompt in a new implementation session.

---

Implement the required **Use sample credential** fallback for this OpenID4VP verified-email demo. Inspect the current repository before editing, follow its `AGENTS.md` instructions, and implement the feature completely. Do not stop after producing a plan.

## Objective

Digital Credentials API support is unavailable in some Chrome and Android configurations. When `navigator.credentials.get()` is unavailable or rejects, the application must offer an explicit **Use sample credential** action.

The sample replaces only the browser/wallet response-capture step. It must still pass through the normal backend OpenID4VP parsing, cryptographic verification, verified-claim extraction, and account sign-in/sign-up logic. Do not directly mark the sample as valid and do not fabricate a successful account response in the frontend.

## Existing implementation to preserve

Review these files and functions before making changes:

- `src/main.ts`
  - `api()`
  - `digitalCredentialSupport()`
  - `prepareRequest()`
  - `invokeDigitalCredential()`
  - the profile-form submission and current verification-result rendering
- `src/request-config.ts`
- `index.html`
- `src/styles.css`
- `server/index.ts`
  - `POST /api/auth/email/request`
  - `POST /api/auth/email/verify`
  - `POST /api/auth/email/signup`
  - the existing-account versus profile-required branch
- `server/openid4vp.ts`
  - `verifyOpenId4VpResponse()`
  - `verifyGoogleUserInfoSdJwt()`
  - disclosure, holder-key, audience, nonce, `sd_hash`, and freshness checks
- `server/store.ts`
- `server/types.ts`

Keep the supported-device path and its security checks unchanged.

## Required user experience

The normal path remains:

1. Prepare an authentication flow and nonce through the backend.
2. Invoke `navigator.credentials.get()` with the OpenID4VP request.
3. Submit `DigitalCredential.data` to the backend.
4. Verify the presentation on the backend.
5. Continue through the existing sign-in or profile-confirmation/sign-up flow.

The fallback path must be:

1. Prepare the same backend authentication flow.
2. Detect that the Digital Credentials API is unavailable, or catch a rejection from `navigator.credentials.get()`.
3. Display the original error or unsupported-browser explanation.
4. Reveal a clearly labelled **Use sample credential** action.
5. Do not activate the fallback automatically; require an explicit user click.
6. On click, trigger the server-controlled fallback verification flow.
7. Process the backend response through the same frontend result-handling code used by a live credential.
8. Clearly identify `sample` versus `live` mode in status/debug output.
9. Preserve the existing retry behavior.

Refactor the frontend result processing if necessary so the live and sample paths do not duplicate the `signed_in` and `profile_required` handling.

## Editable fixture files

Store the captured material in these dedicated files:

- `fixtures/sample-credential-context.json`
- `fixtures/sample-credential-response.json`

Use the exact initial JSON contents specified later in this prompt.

Requirements for fixture loading:

- Do not embed or duplicate the captured token, issuer JWK, nonce, origin, or validation time in frontend or backend TypeScript constants.
- The server must load both JSON files from disk when the fallback action is triggered, not bundle them into frontend assets.
- Prefer loading them on every fallback request so developers can edit the files and retry without rebuilding the frontend or restarting the backend.
- Resolve paths safely from the project root and validate the loaded JSON structure before using it.
- Return a clear backend error if either file is absent, malformed, or missing required fields.
- Do not expose the local fixture file paths to the browser.
- Keep the fixture server-controlled. The client must not be able to submit arbitrary credentials while requesting relaxed validation.

The response file represents a complete DigitalCredential-like result with `protocol` and `data`. The current backend verifier expects the inner object containing `vp_token`, equivalent to `sampleCredentialResponse.data`. Handle that shape explicitly and validate that the protocol is `openid4vp-v1-unsigned`.

## Backend API and shared account flow

Add a tightly scoped fallback endpoint, for example:

```text
POST /api/auth/email/verify-sample
```

The request should contain the current `flow_id`; the server should load the known fixture files itself. Do not add a generic client-controlled option such as `skipValidation: true`.

The fallback endpoint must:

1. Require a valid, unused, unexpired authentication flow.
2. Preserve the existing request-origin lifecycle check where applicable.
3. Load and validate the dedicated context and response JSON files on demand.
4. Verify the fixture using the sample-specific validation context described below.
5. Consume the authentication flow after successful credential verification.
6. Pass the resulting `VerifiedClaims` into the same existing-account/profile-required logic as the live endpoint.
7. Return the same `VerifyResult` shapes used by the live endpoint, with optional source/debug metadata if useful.

Refactor `server/index.ts` so the live and sample endpoints share the code that performs:

- account lookup by verified email;
- returning-account sign-in;
- `lastSignInAt` updates;
- demo session cookie creation;
- signup transaction creation; and
- the `profile_required` response.

Do not duplicate the complete live verification route.

## Sample-specific verification policy

Create an explicit, server-internal distinction between live and sample verification. A reasonable structure is a shared internal verifier plus public wrappers such as:

```ts
verifyOpenId4VpResponse(...)
verifySampleOpenId4VpResponse(...)
```

The exact API can differ, but the relaxed behavior must not be selectable by arbitrary client input.

Because the response is fixed, sample mode must not depend on the newly generated live-flow nonce or the current wall-clock time. Use the captured `validationTimeSeconds` as a deterministic validation time where supported, or skip only the permitted nonce/timestamp comparisons.

The sample path must still execute all of the following:

- Validate the outer response shape and protocol.
- Locate and parse `vp_token.user_info_query[0]`.
- Parse the SD-JWT presentation.
- Verify the issuer JWT signature using `issuerJwk` from the context file.
- Validate the expected issuer.
- Require `vct === "UserInfoCredential"`.
- Validate the SD-JWT disclosure digests.
- Decode disclosures using the same implementation as the live path.
- Extract the holder key from `cnf.jwk`.
- Cryptographically verify the Key Binding JWT using the holder key.
- Validate `sd_hash`, binding the Key Binding JWT to the disclosed SD-JWT.
- Validate the sample audience against the captured origin/context.
- Require `email_verified === true`.
- Build `VerifiedClaims` through the same claim extraction code used by the live path.

Only these fixed-fixture accommodations are allowed:

- Do not require the sample nonce to match the fresh live-flow nonce. If the sample nonce is checked, check it against the nonce in `sample-credential-context.json`.
- Do not compare the issuer JWT or Key Binding JWT timestamps to the current wall clock. Use `validationTimeSeconds` for deterministic validation, or omit only those time/freshness checks in sample mode.
- Accept the fixture's Key Binding `iat` representation when applying the sample time policy.

Do not disable issuer-signature, disclosure, holder-key-signature, `sd_hash`, issuer, credential-type, audience, or verified-email checks.

The captured Key Binding JWT audience is `http://localhost:8080`. The current live implementation constructs an audience in the form `origin:<origin>`. Support the captured audience exactly in sample mode without weakening or changing the live audience rule.

Use the supplied Ed25519 issuer JWK for deterministic sample signature verification. Do not depend on Google's current remote JWKS for the sample because keys may rotate and the fixture is intended to remain editable and replayable.

## Security constraints

- Never accept an arbitrary client-supplied `skipNonce`, `skipTime`, `sampleMode`, or `skipValidation` flag.
- Never apply the sample validation policy to a client-supplied credential.
- Never weaken the existing live-credential path.
- Keep the fixture files out of the frontend bundle.
- Make the fallback visibly demo-only in the UI and documentation.
- Avoid logging the complete presentation unless existing explicit debug behavior requires it.

## Tests

Add focused automated tests that prove:

1. The unmodified fixture loads from the dedicated files and verifies successfully.
2. The fixture remains deterministic independently of the current date.
3. A modified issuer JWT or issuer signature fails.
4. A modified disclosure fails digest validation.
5. A modified Key Binding JWT or `sd_hash` fails.
6. An invalid issuer or credential type fails.
7. The sample audience is checked against the captured context.
8. The live path still rejects an incorrect nonce.
9. The live path still enforces its current freshness/timestamp behavior.
10. Arbitrary client responses cannot opt into the relaxed sample policy.
11. The fallback result enters the same `profile_required` or `signed_in` account branch as a live result.
12. Malformed or missing fixture files produce a controlled backend error.

Add frontend tests where practical for displaying the fallback action when support is unavailable and after `navigator.credentials.get()` rejects.

## Documentation

Update `README.md` with:

- when the fallback appears;
- how to trigger it;
- the locations of the two editable fixture files;
- confirmation that the files are loaded on fallback invocation;
- which validation checks remain active;
- which nonce/time accommodations apply only to the fixture; and
- a clear statement that fallback mode is for demo/development use, not production authentication.

## Acceptance criteria

- Supported-device behavior remains unchanged.
- Unsupported browsers show **Use sample credential**.
- A rejected `navigator.credentials.get()` call also offers the action.
- The action is explicit and is never automatically selected.
- Triggering it loads the current contents of both dedicated JSON files.
- Editing either JSON file affects the next fallback attempt without rebuilding the frontend; preferably no server restart is required.
- The supplied fixture is cryptographically verified on the backend.
- Only nonce and wall-clock-dependent checks receive the fixed-fixture treatment.
- The verified sample enters the normal account flow.
- First use can lead to profile confirmation and account creation.
- Subsequent use can sign in to the completed account.
- The UI/debug output identifies sample mode.
- No generic validation-bypass API is introduced.
- Type checking, tests, and the production build pass.
- The repository knowledge graph is updated after code changes as required by `AGENTS.md`.

## Initial fixture: `fixtures/sample-credential-context.json`

```json
{
  "nonce": "MUWJAbOey9KL9ETthO1cWlCBQq95dpVLRY2qtS1RhGE",
  "origin": "http://localhost:8080",
  "validationTimeSeconds": 1786477425,
  "issuerJwk": {
    "alg": "EdDSA",
    "crv": "Ed25519",
    "key_ops": ["verify"],
    "kty": "OKP",
    "use": "sig",
    "x": "dCCZZmy3Zuy8R8i0ed0GEa0Hhqum2OrhR1lJ7x4vN_E"
  }
}
```

## Initial fixture: `fixtures/sample-credential-response.json`

```json
{
  "protocol": "openid4vp-v1-unsigned",
  "data": {
    "vp_token": {
      "user_info_query": [
        "eyJhbGciOiJFZERTQSIsInR5cCI6InZjK3NkLWp3dCJ9.eyJfc2QiOlsiMGNmUVYwTEhoV3B0eXliT2pQYVZiRG9uZmc2LVZNR1E3VXhENENtc2pZUSIsIjc4ckY0T3g0UEFrQW5pX1owY1RzR2RGYWUxamxtU0praEV1YndCVEZKUVUiLCIydXRjZThxVmlNOWZMVFZBYWE5QVN0VURuemRzdjVsZWd6T0NCWTJWTkFZIiwiMHdDaHB6TkxVRlpBa1VyS05VVDFYRXhNdS1yc25KeURzUzFfakY5MUE3WSIsImV5WV96QVZ6bHhRaW42MWpkRlM2a0JxbUNNOTRrSU1tdEUzU1JLSWNNSDQiLCJ5S3B0ZHc5a0VSem9oWGtkWUFXLXByd0lxLWhNbER3dXVndTVtNkdLaDg4IiwiYjJtQnFLTkxDYkplNzBGaXJsbkdkUGxxQnowcFB2VU9uY0xSQ1RiemhHRSJdLCJfc2RfYWxnIjoic2hhLTI1NiIsImNuZiI6eyJqd2siOnsiY3J2IjoiUC0yNTYiLCJrdHkiOiJFQyIsIngiOiJwMmd4TWRQVTgxOGhqbmhpcTRMUjZIdlFJM2VwNnZfdS1sdklnbWlzRHZFIiwieSI6Iml1SVVMZk5HaXNlRmZ5eVgxTksya3I3ZmJpa2NVRk45aUJRNkZwdC1mMlEifX0sImV4cCI6MTc4NzAwODIyNCwiaWF0IjoxNzg2NDAzNDI0LCJpc3MiOiJodHRwczovL3ZlcmlmaWFibGVjcmVkZW50aWFscy1wYS5nb29nbGVhcGlzLmNvbSIsInZjdCI6IlVzZXJJbmZvQ3JlZGVudGlhbCJ9.Nh7_4-yXg10XpCkhHRv2f76zW0L8RylCwvLpOqN_M05OnQrvrpo3TUnxxW-5f4tPY_Qnlhz8a8eCQYNcuX0lBw~WyJxMUlCdy1SSjVsYW9zMDFLaTFJTDBnIiwiZW1haWwiLCJyeWFuLndhdGtpbnNAbWFzdGVyY2FyZC5jb20iXQ~WyJSZDRIU1FtbzVqOXh1T011bGVYTFR3IiwiZW1haWxfdmVyaWZpZWQiLHRydWVd~WyJtWVNZVVA2MzdpSEc1R1JrMnl0eG5nIiwiZ2l2ZW5fbmFtZSIsIlJ5YW4iXQ~WyJuWTZQcTFHVEdYQUhsU01NVmN6SHdRIiwiZmFtaWx5X25hbWUiLCJXYXRraW5zIl0~WyJfV0JrVUpEekhWMXpLelR6QmhmT2F3IiwibmFtZSIsIlJ5YW4gV2F0a2lucyJd~WyJOQlRXQ19SamJwOGxxb3AtYWtadnRRIiwicGljdHVyZSIsImh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FDZzhvY0pkdGFGVHAxdU9LSUhQMUNjUVBNMGNUeDRLRHFVNTdzWHNfRm5Ka25JMG42V0l0NC1VPXM5Ni1jIl0~WyJUNDB2ZE83bVR4ZkFRVWlUMnpDc0VnIiwiaGQiLCIiXQ~eyJhbGciOiJFUzI1NiIsInR5cCI6ImtiK2p3dCJ9.eyJub25jZSI6Ik1VV0pBYk9leTlLTDlFVHRoTzFjV2xDQlFxOTVkcFZMUlkycXRTMVJoR0UiLCJhdWQiOiJodHRwOlwvXC9sb2NhbGhvc3Q6ODA4MCIsImlhdCI6IjE3ODY0Nzc0MjUiLCJzZF9oYXNoIjoidTI2ZDZYNHVjMHR6RlFDQ0tiWHNXZGFlS0E2YURTYmFmZEctcnJhTEJSWSJ9.uZh-R5ia0yHrqJmyIq11vn_4Q8-4T1LKF-kxvkY-GB_ddyDTbZ49OONueWwLQEkmjq-X84QcGEVxdrLYPMGXjg"
      ]
    }
  }
}
```

## Completion report

After implementation, report:

- files changed;
- the live/sample verification design;
- how and when the fixture files are loaded;
- checks retained in sample mode;
- checks treated differently in sample mode;
- endpoint and UI behavior;
- tests and commands run; and
- remaining demo limitations.
