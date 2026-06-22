# Chaq Local Infrastructure

Chaq development infrastructure uses local PostgreSQL and Docker Redis. `E:\Environment\Chaq` is the source of truth for Chaq runtime environment files and PostgreSQL data.

## Paths

- Environment file: `E:\Environment\Chaq\server.env`
- PostgreSQL binaries: `E:\Environment\pgsql\bin`
- PostgreSQL data: `E:\Environment\Chaq\postgres-data`
- PostgreSQL log: `E:\Environment\Chaq\logs\postgres.log`
- Redis data: Docker volume `chaq_redis-data`

## Ports

- API server: `127.0.0.1:24537`
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

Use `tools\start-all.bat` to open both server and desktop windows.

`tools\start-server.bat` prepares the local environment, starts local PostgreSQL, starts Docker Redis with `docker compose up -d redis`, applies migrations, seeds users, then starts the NestJS API server.

The compose file only defines Redis. PostgreSQL is intentionally not managed by Docker for this project.

## PostgreSQL Windows Service

PostgreSQL can run as a Windows service named `ChaqPostgreSQL`. If PostgreSQL is already running from `pg_ctl`, stop that manual process before starting the service:

```powershell
& "E:\Environment\pgsql\bin\pg_ctl.exe" stop -D "E:\Environment\Chaq\postgres-data" -m fast -w
Start-Service ChaqPostgreSQL
```

If the service was previously registered for an old port, re-register it:

```powershell
Stop-Service ChaqPostgreSQL
& "E:\Environment\pgsql\bin\pg_ctl.exe" unregister -N "ChaqPostgreSQL"
& "E:\Environment\pgsql\bin\pg_ctl.exe" register -N "ChaqPostgreSQL" -D "E:\Environment\Chaq\postgres-data" -S auto -o "-p 45432 -h 127.0.0.1"
Start-Service ChaqPostgreSQL
```

Verify:

```powershell
Get-Service ChaqPostgreSQL
& "E:\Environment\pgsql\bin\pg_isready.exe" -h 127.0.0.1 -p 45432 -U chaq
```
