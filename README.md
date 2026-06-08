# Chaq

Chaq is a desktop-first virtual skill chat app. Users create skills from manual input or imported chat exports, talk with those skills through cloud or user-supplied models, and publish finished skills to a marketplace where other users can like, dislike, comment anonymously, favorite, and import their own copy.

## Stack

- Desktop: Electron, React, TypeScript, Vite
- Server: NestJS, Prisma, PostgreSQL
- Queue/cache foundation: Redis, BullMQ-ready server layout
- Local storage: SQLite in the Electron main process
- AI: platform cloud model proxy plus user-owned provider configs

## Quick Start

1. Copy `.env.example` to `apps/server/.env`.
2. Start Postgres and Redis with `docker compose up -d`.
3. Prepare environment directories with `npm.cmd run env:prepare`.
4. Install dependencies with `npm.cmd install`.
5. Generate Prisma client with `npm run prisma:generate`.
6. Create database tables with `npm run prisma:migrate`.
7. Seed demo providers with `npm run prisma:seed`.
8. Run the server with `npm run dev:server`.
9. Run the desktop app with `npm run dev:desktop`.

PowerShell may block `npm.ps1`; use `npm.cmd` instead if that happens.

The default dev ports are `4537` for the API server and `5737` for the Electron renderer. Dev scripts check these ports before starting and avoid the existing web project ports `4100`, `4010`, `8200`, and `8020`.

Project dependency caches and Electron user data are configured under `E:\Environment\Chaq`. If dependency installation is interrupted while downloading Electron, rerun `npm.cmd run electron:install` before starting the desktop app. The local app database is SQLite via `sql.js`, so it does not require native SQLite build tools.

## Demo Accounts

The seed inserts three roles. All passwords are `123456`.

- `admin`: administrator, can access model provider backend.
- `creator`: creator role, reserved for creator-specific marketplace permissions.
- `demo`: normal user.

Avatar storage paths are reserved as `/avatars/admin.png`, `/avatars/creator.png`, and `/avatars/user.png`.

The default generated cover asset lives at `apps/desktop/src/renderer/assets/chaq-cover.png`.
