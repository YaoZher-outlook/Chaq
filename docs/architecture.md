# Chaq Architecture

## Product Boundary

Chaq does not implement human-to-human private chat in v1. Human interaction happens only in the marketplace through public skill publishing, likes, dislikes, favorites, imports, and front-stage anonymous comments.

## Local-First Desktop

The Electron main process owns local SQLite and encrypted user model API keys. The React renderer only calls a constrained preload API. Private source exports, chat logs, skill drafts, and user-owned model configs stay local by default.

## Server

The NestJS server owns account state, marketplace data, anonymous comment moderation links, platform cloud model routing, and token billing. A development user is identified by `x-user-id`; missing users are created automatically so the MVP can be tested before a full auth system exists.

## Models

Platform cloud model calls go through `/api/models/cloud/chat`, where provider credentials are hidden, estimated balance checks happen before the call, and actual token charges are written afterward.

User-owned models are configured in the desktop app and called directly from the Electron main process. Those calls do not consume platform token balance.

## Import And Distillation

The desktop importer supports generic `.txt`, `.csv`, `.json`, `.html`, and `.md` files. WeChat and QQ support means users export records with external tools first, then import the resulting file. Distillation can use a configured cloud provider; if none is available, the app generates a deterministic local draft so users can continue editing.

## Token

The v1 token ledger supports recharge, cloud model usage, refund, and admin adjustment. It is intentionally limited to cloud model consumption; paid marketplace skills and creator revenue sharing are left as future extensions.
