# Production Deployment

## Required Configuration

Use `.env.production.example` as a template. Required secrets:

- `POSTGRES_PASSWORD`: long random database password.
- `MODEL_SECRET_KEY`: at least 32 random characters, stored in a secret manager.
- `CLIENT_ORIGIN`: exact allowed origin; for the live Chaq host use `https://chaq.yaozher.com`.
- `PUBLIC_API_URL`: public API base URL; for the live Chaq host use `https://chaq.yaozher.com/api`.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`: transactional email credentials used by registration and email binding.

The production Compose file runs five services: PostgreSQL, Redis, one-shot migration, API, and Agent worker.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Do not run `prisma:seed` in production. The development seed creates only `admin / 123456` with `9999` platform tokens and refuses to run when `NODE_ENV=production`.

## Network And TLS

Expose only the API through a TLS reverse proxy. PostgreSQL and Redis have no public port mappings in the production Compose file. Chaq applies Redis-backed application limits; add a second layer of request limits at the proxy and forward only trusted headers. The proxy must pass WebSocket upgrades for `/api/realtime`.

For the Windows production launcher, Cloudflared should use:

- Hostname: `chaq.yaozher.com`
- Service: `http://127.0.0.1:24538`
- Public API URL: `https://chaq.yaozher.com/api`

Do not put `/api` in the Cloudflared service target. Docker Compose exposes the API through `${PUBLIC_API_PORT:-24537}`; set `PUBLIC_API_PORT=24538` to use the same Cloudflared service target.

Readiness checks use `GET /api/health/ready`; liveness checks use `GET /api/health/live`.

## Auth And Email

Registration and email binding use six-digit email codes that expire after 10 minutes and are consumed once. Chaq applies Redis-backed limits to code sending, code verification attempts, and credential routes. In production, configure SMTP credentials and keep proxy-level rate limits enabled for `/api/auth/*` and `/api/users/me/email-code`.

Create the first administrator explicitly after migrations. This script creates the user when missing, promotes it to `ADMIN`, resets its password to the provided value, and creates default user settings:

```bash
CHAQ_ADMIN_USERNAME=admin CHAQ_ADMIN_PASSWORD='replace-with-a-strong-password' npm run admin:create
```

On PowerShell:

```powershell
$env:CHAQ_ADMIN_USERNAME="admin"
$env:CHAQ_ADMIN_PASSWORD="replace-with-a-strong-password"
npm.cmd run admin:create
```

For Docker Compose:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml run --rm -e CHAQ_ADMIN_USERNAME=admin -e CHAQ_ADMIN_PASSWORD='replace-with-a-strong-password' api node scripts/create-admin-user.js
```

## Desktop Build

Build the desktop client against the public API URL:

```bash
VITE_SERVER_URL=https://chaq.yaozher.com/api npm run build -w @chaq/desktop
npm run dist -w @chaq/desktop
```

On PowerShell:

```powershell
$env:VITE_SERVER_URL="https://chaq.yaozher.com/api"
npm.cmd run build -w @chaq/desktop
npm.cmd run dist -w @chaq/desktop
```

The desktop client also defaults to `https://chaq.yaozher.com/api` when no `VITE_SERVER_URL` is provided. Local API fallback is disabled in packaged builds unless `VITE_ALLOW_LOCAL_API_FALLBACK=1` is set.

Sign installers before distribution. Keep Electron and Chromium current and test auto-update packages in a staging channel before enabling production updates.

## Database Operations

- Run `prisma migrate deploy` as a one-shot release job before API/worker rollout.
- Back up PostgreSQL daily and verify restores.
- Retain Agent run/events according to a documented privacy policy.
- Rotate `MODEL_SECRET_KEY` through a controlled credential re-encryption job; changing it without re-encryption makes existing provider keys unreadable.

## Scaling

- Scale API based on request traffic.
- Scale workers based on BullMQ waiting/active counts and model-provider limits.
- Set `AGENT_WORKER_CONCURRENCY` conservatively to avoid provider rate limits.
- Tune `MODEL_REQUEST_TIMEOUT_MS` to the provider SLA while keeping it below the worker's operational timeout.
- Verify Redis-backed credential and API rate limits under expected peak traffic.
- Export structured logs and alerts for failed runs, queue depth, provider latency, token spend, database saturation, and readiness failures.

## Release Gate

Before a release:

```bash
npm test
npm run typecheck
npm run build
docker compose --env-file .env.production -f docker-compose.production.yml config
```

Then validate login, Agent creation, human message wake-up, scheduled wake-up, Agent-to-Agent messaging, pause/resume, budget exhaustion, marketplace compatibility, and desktop packaging in staging.
