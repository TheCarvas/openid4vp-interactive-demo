# Deploying to Hostinger

Live at `https://openid4vp.lionwolfstar.tech`, served from a Hostinger **VPS**.

> **This document was rewritten to match what is actually deployed.** An earlier
> version described an hPanel Node.js app on Business shared hosting. That is not
> what runs, and it is not reachable from this account — see
> [Why a VPS](#why-a-vps-and-not-shared-hosting).

## Branches

`main` is the trunk. `hostinger-demo` is the release branch — merging into it is
what deploys.

Keeping deployment on its own branch means work can land on `main` without going
live, and the demo can be pinned to a known-good commit while `main` moves. The
cost is that the two branches drift, so treat a release as an explicit step: open
a pull request from `main` (or from a feature branch) into `hostinger-demo` when
you want the site updated. CI runs on every pull request regardless of target.

## What this app needs from a host

This is not a static site. It is an Express server that verifies OpenID4VP
credential presentations and serves the built client from the same origin:

- **A persistent Node process** (Node >= 20.19).
- **HTTPS.** The browser Digital Credentials API and the `secure` session cookie
  both require it.
- **Writable storage** for `accounts.json`, `activity.json`, and diagnostic traces.
- **Same origin for the page and the API.** The client calls `/api/...`
  relatively, and the verifier binds each flow to the browser's origin, which
  becomes the audience the wallet signs over. Splitting the frontend and API
  across hosts breaks verification.

## Why a VPS, and not shared hosting

Hostinger runs Node.js apps on **Business** and **Cloud** plans only. This
account's sole hosting order is **Premium**, which is PHP-only, and the Hostinger
billing API exposes no shared-hosting plans at all — so there is no programmatic
upgrade path either. A VPS was provisioned instead.

The trade-off worth knowing: **Hostinger does not manage TLS certificates on a
VPS.** Free auto-renewing SSL is a managed shared-hosting feature. On a VPS you
own nginx, the certificate, and the service unit. This setup uses certbot, which
automates issuance and renewal — but it is yours to keep working.

## The deployed topology

| Thing | Value |
| --- | --- |
| VPS | `srv1921389.hstgr.cloud` (id `1921389`), KVM 1, Ubuntu 24.04 LTS |
| IPv4 | `185.97.144.159` |
| DNS | `openid4vp` A record in the `lionwolfstar.tech` zone, TTL 300 |
| Node | 22.x, from NodeSource |
| App directory | `/srv/openid4vp/app` |
| Data directory | `/srv/openid4vp/data` |
| Environment file | `/etc/openid4vp-demo.env` (`0640`, `root:openid4vp`) |
| Service | `openid4vp-demo.service`, running as user `openid4vp` |
| Reverse proxy | nginx, `/etc/nginx/sites-available/openid4vp` |
| TLS | Let's Encrypt via certbot, auto-renewed by `certbot.timer` |
| Firewall | Hostinger firewall group `openid4vp-web` — TCP 22, 80, 443 only |

`DATA_DIR` deliberately sits **outside** the application directory. A deploy
replaces the contents of `/srv/openid4vp/app`, so a datastore left at the default
`./.data` would be erased on every release.

### A note on the listening address

`server/index.ts` calls `app.listen(config.port, '0.0.0.0')`, so the app binds
every interface even though it logs `http://127.0.0.1:...`. Behind a reverse
proxy that means the app is also reachable directly on port 3000 over plaintext
HTTP, bypassing TLS — which matters here, because the verifier binds each flow to
the browser's origin.

Two things block that on this host:

1. The Hostinger firewall group, which permits only 22/80/443. Note it is enforced
   **upstream** of the VM — the guest's own `iptables` `INPUT` policy remains
   `ACCEPT`, so you cannot confirm it from inside the machine.
2. `/etc/nftables-o4vp.conf`, applied at boot by the `o4vp-guard` service, which
   drops non-loopback traffic to port 3000 on both IPv4 and IPv6.

The real fix is to make the bind address configurable and default it to
loopback. Until then, do not remove either guard.

IPv6 is intentionally **not** published — there is no `AAAA` record — because the
edge firewall's IPv6 coverage was never verified.

## Deploying

### Automatic, via GitHub Actions

`.github/workflows/deploy-hostinger.yml` builds on a runner and ships the result
over rsync: it uploads `dist/`, `dist-server/`, `fixtures/` and the manifests,
runs `npm ci --omit=dev` on the host, restarts the service, and health-checks it.
Building on the runner rather than on the VPS matters — KVM 1 has a single vCPU.

It stays dormant until `HOSTINGER_DEPLOY_ENABLED` is `true`. Configure under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `HOSTINGER_SSH_HOST` | `185.97.144.159` |
| `HOSTINGER_SSH_USER` | `openid4vp` |
| `HOSTINGER_SSH_PORT` | `22` |
| `HOSTINGER_SSH_KEY` | Private half of the `openid4vp-demo-deploy` keypair |
| `HOSTINGER_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -p 22 185.97.144.159` |
| `HOSTINGER_APP_PATH` | `/srv/openid4vp/app` |

| Variable | Value |
| --- | --- |
| `HOSTINGER_DEPLOY_ENABLED` | `true` |
| `HOSTINGER_RESTART_COMMAND` | `sudo systemctl restart openid4vp-demo` |
| `HOSTINGER_HEALTH_URL` | `https://openid4vp.lionwolfstar.tech/api/health` |

The deploy user is unprivileged. Its sudo rights are limited by
`/etc/sudoers.d/openid4vp-demo` to restarting and querying this one service — it
cannot run anything else as root.

Setting them, from a machine holding the private key:

```bash
gh secret set HOSTINGER_SSH_HOST --body "185.97.144.159"
gh secret set HOSTINGER_SSH_USER --body "openid4vp"
gh secret set HOSTINGER_SSH_PORT --body "22"
gh secret set HOSTINGER_APP_PATH --body "/srv/openid4vp/app"
gh secret set HOSTINGER_SSH_KEY < ~/.ssh/openid4vp_hostinger_ed25519
ssh-keyscan -p 22 185.97.144.159 2>/dev/null | gh secret set HOSTINGER_SSH_KNOWN_HOSTS
gh variable set HOSTINGER_RESTART_COMMAND --body "sudo systemctl restart openid4vp-demo"
gh variable set HOSTINGER_HEALTH_URL --body "https://openid4vp.lionwolfstar.tech/api/health"
gh variable set HOSTINGER_DEPLOY_ENABLED --body "true"
```

Set `HOSTINGER_DEPLOY_ENABLED` **last** — it is the switch that arms everything
else.

### Manual, over SSH

`/usr/local/bin/openid4vp-redeploy` clones the branch, builds on the box, swaps
the artifacts in and restarts:

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
```bash
ssh openid4vp@185.97.144.159 sudo openid4vp-redeploy
```

Use this for recovery, or when you want to deploy without a merge. Do not run it
concurrently with an Actions deploy.

## Protecting the release branch

Repository **Settings → Branches → Add rule** for `hostinger-demo`:

- Require a pull request before merging.
- Require status checks to pass: **`verify`**.

That closes the loop: open a PR into `hostinger-demo` → CI verifies → merge →
Actions deploys → the health check confirms it is serving.

## Operating it

```bash
# Is it up?
curl https://openid4vp.lionwolfstar.tech/api/health

# Service state and recent logs
ssh root@185.97.144.159 "systemctl status openid4vp-demo --no-pager"
ssh root@185.97.144.159 "journalctl -u openid4vp-demo -n 50 --no-pager"

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
# Certificate expiry, and a renewal rehearsal
ssh root@185.97.144.159 "certbot certificates"
ssh root@185.97.144.159 "certbot renew --dry-run"
```

The ACME account was registered **without an email address**, so no expiry
warnings are sent anywhere. Renewal is automated by `certbot.timer` and the
dry-run passes, but there is no human fallback if it silently stops. To add one:

```bash
ssh root@185.97.144.159 "certbot update_account --email you@example.com"
```

## Before you make it public

Two things about this demo change character once it is on the open internet:

- **It stores real personal data.** A successful sign-in writes a real, verified
  email address and profile into `accounts.json`, and sign-in activity into
  `activity.json`. There is no admin authentication in front of that data, and no
  deletion path. `DATA_DIR` is outside the web root, but decide whether a public
  demo should retain it at all.
- **`CAPTURE_CREDENTIAL_ARTIFACTS=true` writes presented credentials to disk**,
  including the raw SD-JWT and its disclosures. It is `false` in production,
  alongside `DEBUG_UI_ENABLED`, which exposes verifier internals in API
  responses. Both must stay off.

The sample-credential fallback is a development aid and is not authentication; it
remains available in the deployed app whenever a live presentation cannot be
captured.

## Local development

Unchanged:

```bash
npm install
cp .env.example .env
npm run dev            # API on 3000 + Vite on 5173
```

`npm run start:dev` runs the server straight from TypeScript via tsx.
`npm start` runs the compiled output and requires `npm run build` first.
