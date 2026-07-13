# Chaq Local Infrastructure

Chaq development infrastructure uses local PostgreSQL and Docker Redis. The repository-relative `.chaq-data` directory is the default source of truth for runtime environment files and PostgreSQL data, so the project does not depend on a particular drive letter.

## Paths

- Environment file: `.chaq-data\server.env`
- PostgreSQL binaries: `.chaq-data\postgresql\bin` (override with `CHAQ_PG_BIN`)
- PostgreSQL data: `.chaq-data\postgres-data`
- PostgreSQL log: `.chaq-data\logs\postgres.log`
- Redis data: Docker volume `chaq_redis-data`

## Ports

- Development API server: `127.0.0.1:24537`
- Production/public API server: `0.0.0.0:24538`
- Desktop renderer: `127.0.0.1:27337`
- PostgreSQL: `127.0.0.1:45432`
- Redis: `127.0.0.1:46379`

## DataGrip

- Host: `127.0.0.1`
- Port: `45432`
- Database: `chaq`
- User: `chaq`
- Password: `chaq`
- JDBC URL: `jdbc:postgresql://127.0.0.1:45432/chaq`
- URL-only JDBC URL: `jdbc:postgresql://127.0.0.1:45432/chaq?user=chaq&password=chaq`
- psql:

```powershell
psql "host=127.0.0.1 port=45432 user=chaq dbname=chaq password=chaq"
```

## Startup

Use `tools\start-server-dev.bat` to start the development API and Agent worker, then use `tools\start-client.bat` to open the desktop client.

`tools\start-server-dev.bat` prepares the local environment, starts local PostgreSQL, starts Docker Redis with `docker compose up -d redis`, applies migrations, then starts the NestJS API server and Agent worker in watch mode.

For production/public binding, use `tools\start-server-prod.bat`. It starts the production API and Agent worker on `0.0.0.0:24538`, manages them in the background, and writes runtime logs to `.logs\api-prod.log` and `.logs\worker-prod.log`. Use `node scripts\start-production-server.js --stop` to stop them.

The compose file only defines Redis. PostgreSQL is intentionally not managed by Docker for this project.

## PostgreSQL Windows Service

PostgreSQL can run as a Windows service named `ChaqPostgreSQL`. If PostgreSQL is already running from `pg_ctl`, stop that manual process before starting the service:

```powershell
$pgBin = Resolve-Path ".\.chaq-data\postgresql\bin"
$pgData = Resolve-Path ".\.chaq-data\postgres-data"
& "$pgBin\pg_ctl.exe" stop -D $pgData -m fast -w
Start-Service ChaqPostgreSQL
```

If the service was previously registered for an old port, re-register it:

```powershell
Stop-Service ChaqPostgreSQL
$pgBin = Resolve-Path ".\.chaq-data\postgresql\bin"
$pgData = Resolve-Path ".\.chaq-data\postgres-data"
& "$pgBin\pg_ctl.exe" unregister -N "ChaqPostgreSQL"
& "$pgBin\pg_ctl.exe" register -N "ChaqPostgreSQL" -D $pgData -S auto -o "-p 45432 -h 127.0.0.1"
Start-Service ChaqPostgreSQL
```

Verify:

```powershell
Get-Service ChaqPostgreSQL
$pgBin = Resolve-Path ".\.chaq-data\postgresql\bin"
& "$pgBin\pg_isready.exe" -h 127.0.0.1 -p 45432 -U chaq
```
