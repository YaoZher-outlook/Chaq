# Production Deployment

## Required Configuration

Use `.env.production.example` as a template. Required secrets:

- `POSTGRES_PASSWORD`: long random database password.
- `MODEL_SECRET_KEY`: at least 32 random characters, stored in a secret manager.
- `CLIENT_ORIGIN`: exact allowed origin; do not use `*` with credentials.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`: transactional email credentials used by registration and email binding.

The production Compose file runs five services: PostgreSQL, Redis, one-shot migration, API, and Agent worker.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Do not run `prisma:seed` in production. The development seed creates only `admin / 123456` with `9999` platform tokens and refuses to run when `NODE_ENV=production`.

## Network And TLS

Expose only the API through a TLS reverse proxy. PostgreSQL and Redis have no public port mappings in the production Compose file. Chaq applies Redis-backed application limits; add a second layer of request limits at the proxy and forward only trusted headers. The proxy must pass WebSocket upgrades for `/api/realtime`.

Readiness checks use `GET /api/health/ready`; liveness checks use `GET /api/health/live`.

## Auth And Email

Registration and email binding use six-digit email codes that expire after 10 minutes and are consumed once. Chaq applies Redis-backed limits to code sending, code verification attempts, and credential routes. In production, configure SMTP credentials and keep proxy-level rate limits enabled for `/api/auth/*` and `/api/users/me/email-code`.

## Desktop Build

Build the desktop client against the public API URL:

```bash
VITE_SERVER_URL=https://api.example.com/api npm run build -w @chaq/desktop
npm run dist -w @chaq/desktop
```

On PowerShell:

```powershell
$env:VITE_SERVER_URL="https://api.example.com/api"
npm.cmd run build -w @chaq/desktop
npm.cmd run dist -w @chaq/desktop
```

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
