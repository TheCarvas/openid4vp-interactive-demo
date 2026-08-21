# Deploying to Hostinger

Target: `https://openid4vp.lionwolfstar.tech`, deployed automatically when a
pull request merges into `hostinger-demo`.

## Branches

`main` is the trunk. `hostinger-demo` is the release branch, and it is the only
branch Hostinger watches — merging into it is what deploys.

Keeping deployment on its own branch means work can land on `main` without
going live, and the demo can be pinned to a known-good commit while `main`
moves. The cost is that the two branches drift, so treat a release as an
explicit step: open a pull request from `main` (or from a feature branch) into
`hostinger-demo` when you want the site updated. CI runs on every pull request
regardless of which branch it targets.

## What this app needs from a host

This is not a static site. It is an Express server that verifies OpenID4VP
credential presentations and serves the built client from the same origin:

- **A persistent Node process** (Node >= 20.19). Hostinger runs Node apps on
  **Business** and **Cloud** plans only; Premium and Single do not.
- **HTTPS.** The browser Digital Credentials API and the `secure` session cookie
  both require it.
- **Writable storage** for `accounts.json`, `activity.json`, and diagnostic
  traces.
- **Same origin for the page and the API.** The client calls `/api/...`
  relatively, and the verifier binds each flow to the browser's origin, which
  becomes the audience the wallet signs over. Splitting the frontend and API
  across hosts breaks verification — do not serve the UI from static hosting and
  the API from somewhere else.

If your plan turns out to be Premium rather than Business, upgrading to Business
is the smallest change; a Hostinger VPS also works but you manage nginx,
certificates, and the service unit yourself.

## Recommended setup

Hostinger's Node.js app deploys from a GitHub repository and rebuilds on push,
so the automation you asked for needs no deployment secrets at all:

- **GitHub Actions is the gate.** `.github/workflows/ci.yml` runs the type check,
  the test suite, a full build, and boots the compiled server with production
  dependencies only on every pull request.
- **Hostinger is the deployer.** It watches `hostinger-demo` and redeploys on
  merge.
- **Branch protection connects the two.** Require the `verify` check on
  `hostinger-demo` so nothing reaches Hostinger without a green build.

### 1. Point the subdomain at the hosting account

In hPanel, create the subdomain `openid4vp` under `lionwolfstar.tech`, then
issue the free SSL certificate for it (SSL → install for the subdomain).

### 2. Create the Node.js app

hPanel → **Websites → Node.js** (Business/Cloud plans) → create an app:

| Setting | Value |
| --- | --- |
| Repository | `TheCarvas/openid4vp-interactive-demo` |
| Branch | `hostinger-demo` |
| Node version | 22 (or 20; must be >= 20.19) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Domain | `openid4vp.lionwolfstar.tech` |

`npm run build` produces both halves of the release: `vite build` writes the
client into `dist/`, and `tsc -p tsconfig.server.json` compiles the server into
`dist-server/`. `npm start` then runs `node dist-server/server/index.js`, which
needs no dev dependencies — this matters because the host installs production
dependencies only.

### 3. Set the environment variables

Copy them from [`.env.production.example`](.env.production.example) into the
app's environment settings. Two are not optional:

- `PUBLIC_ORIGIN=https://openid4vp.lionwolfstar.tech` — pins the origin a flow
  can be bound to. Without it the app trusts `X-Forwarded-Host` from the
  hosting proxy to decide the OpenID4VP audience.
- `DATA_DIR=/home/uXXXXXXXX/openid4vp-demo-data` — a directory **outside** the
  application directory. A git-based redeploy replaces the app directory, so a
  datastore left at the default `./.data` is erased on every merge.

Do not set `PORT` to a fixed value if hPanel injects one; the server reads
`process.env.PORT` and falls back to 3000.

`BIND_HOST` (alias: `HOST`) chooses the interface the server listens on, and
defaults to `127.0.0.1`. Leave it unset behind any reverse proxy — including
hPanel's and nginx on a VPS. The proxy terminates TLS and forwards to loopback,
and a loopback bind is what keeps the app from *also* answering on its raw port
over plaintext HTTP. That is not merely untidy here: the verifier binds each
OpenID4VP flow to the browser's origin, so an app reachable on a second
origin and scheme undermines the guarantee the flow rests on. Set
`BIND_HOST=0.0.0.0` only where direct exposure is intended — a container whose
port you publish deliberately, for instance. The startup log prints the address
actually bound, and warns when it is not loopback.

### 4. Enable automatic deployment

Turn on auto-deploy (or "deploy on push") for the `hostinger-demo` branch in the
app's Git settings. If your panel offers a webhook URL instead, add it under the
repository's **Settings → Webhooks** with the `push` event.

### 5. Protect `hostinger-demo`

Repository **Settings → Branches → Add rule** for `hostinger-demo`:

- Require a pull request before merging.
- Require status checks to pass: **`verify`**.

That is the whole loop: open a PR into `hostinger-demo` → CI verifies it →
merge → Hostinger rebuilds and restarts → the change is live.

### 6. Verify

```bash
curl https://openid4vp.lionwolfstar.tech/api/health
```

Then open the site in Chrome on an Android device with a wallet holding a
verified email credential and run the sign-in flow.

## Alternative: deploy from GitHub Actions over SSH

Use this only if you want Actions to own the deployment — for example to build
on a Node version the panel does not offer, or to deploy to a VPS.
`.github/workflows/deploy-hostinger.yml` builds, ships `dist/`, `dist-server/`,
`fixtures/`, and the manifests over rsync, installs production dependencies on
the host, restarts, and health-checks the result.

On a VPS you own the proxy, so this is where the bind address matters most:
keep `BIND_HOST` unset so the app listens on `127.0.0.1`, point nginx or Apache
at it, and confirm from off the host that `http://<server-ip>:3000/api/health`
does *not* answer. A firewall rule dropping non-loopback traffic to the port is
worth keeping as a second layer, but it should not be the only thing standing
between the internet and the app.

It is dormant until you set the repository variable
`HOSTINGER_DEPLOY_ENABLED` to `true`. Configure under **Settings → Secrets and
variables → Actions**:

| Secret | Value |
| --- | --- |
| `HOSTINGER_SSH_HOST` | SSH hostname or IP from hPanel → Advanced → SSH Access |
| `HOSTINGER_SSH_USER` | SSH username (e.g. `uXXXXXXXX`) |
| `HOSTINGER_SSH_PORT` | SSH port (Hostinger shared hosting is usually not 22) |
| `HOSTINGER_SSH_KEY` | Private key whose public half you added in hPanel |
| `HOSTINGER_SSH_KNOWN_HOSTS` | Optional. Output of `ssh-keyscan -p <port> <host>`. Without it the workflow scans at deploy time, which trusts whatever answers. |
| `HOSTINGER_APP_PATH` | Absolute path of the app directory on the host |

| Variable | Value |
| --- | --- |
| `HOSTINGER_DEPLOY_ENABLED` | `true` |
| `HOSTINGER_RESTART_COMMAND` | Restart command for your host. Defaults to `touch tmp/restart.txt` (Passenger). On a VPS use e.g. `sudo systemctl restart openid4vp-demo`. |
| `HOSTINGER_HEALTH_URL` | `https://openid4vp.lionwolfstar.tech/api/health` |

Both workflows can coexist, but do not enable this one *and* hPanel auto-deploy
on the same branch — they will race and restart the app twice per merge.

## Before you make it public

Two things about this demo change character once it is on the open internet:

- **It stores real personal data.** A successful sign-in writes a real, verified
  email address and profile into `accounts.json`, and sign-in activity into
  `activity.json`. There is no admin authentication in front of that data, and
  no deletion path. Keep `DATA_DIR` outside the web root, and decide whether a
  public demo should retain it at all.
- **`CAPTURE_CREDENTIAL_ARTIFACTS=true` writes presented credentials to disk**,
  including the raw SD-JWT and its disclosures. `.env.example` enables it for
  local development. It must stay `false` in production, along with
  `DEBUG_UI_ENABLED`, which exposes verifier internals in API responses.

The sample-credential fallback is a development aid and is not authentication;
it remains available in the deployed app whenever a live presentation cannot be
captured.

## Local development

Unchanged, other than the dev server entry point:

```bash
npm install
cp .env.example .env
npm run dev            # API on 3000 + Vite on 5173
```

`npm run start:dev` runs the server straight from TypeScript via tsx.
`npm start` runs the compiled output and requires `npm run build` first.
