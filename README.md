# Secure DMS — SIH 2026

Secure Digital Document Management System for legal & investigation
documents (FIRs, witness statements, charge sheets, forensic reports,
evidence records, court filings). Modular monolith: Node/Express API +
Next.js web app + PostgreSQL + encrypted object storage.

The full software & database architecture dossier (system context,
module map, request lifecycle, role/feature flows, lifecycle state
machines, full relational schema, traceability matrix) was produced
alongside this scaffold — drop it into `docs/architecture/` as the
canonical reference once it's added to the repo.

## Stack

- **API**: Node.js + Express (JavaScript, npm workspace `apps/api`)
- **Web**: Next.js (JavaScript, npm workspace `apps/web`)
- **DB**: PostgreSQL, migrations via `node-pg-migrate`
- **Storage**: local encrypted filesystem folder in dev (behind a
  swappable storage-adapter interface — S3-compatible later without
  touching business logic)
- **Crypto (future sprints)**: AES-256-GCM (documents), SHA-256
  (integrity), RSA-SHA256 (signatures), scrypt (passwords)
- **Shared constants**: `packages/shared` (roles, permissions,
  document types)

## Repo layout

```
apps/api        Express API — controller→service→repository→routes→validation per module
apps/web        Next.js frontend
packages/shared Shared constants used by both apps and by DB seed data
```

## Local development

1. `cp .env.example .env` and fill in real values (never commit `.env`).
2. `docker compose up --build` — brings up Postgres, the API, and the web app.
3. `docker compose exec api npm run migrate:up` — applies migrations and
   seeds `roles`, `permissions`, and `document_types` (runs inside the
   `api` container, which already has `DATABASE_URL` from `.env` via
   `env_file`).
4. `curl http://localhost:4000/health` — should return `200` with
   `checks.database: "ok"`.
5. `curl http://localhost:4000/api/v1/audit/health` — proves a request
   reaches a module through the full middleware chain (Helmet, CORS,
   rate limiting, body limits, auth/RBAC stub hooks).

### Without Docker

- Start a local Postgres instance and set `DATABASE_URL` accordingly.
- `npm install` at the repo root (installs all workspaces).
- Load `.env` into your shell so `node-pg-migrate` and the API can see
  `DATABASE_URL` etc. — e.g. (bash) `set -a; source .env; set +a`, or
  use a tool like `dotenv-cli`.
- `npm run migrate:up`
- `npm run dev:api` and, separately, `npm run dev:web`.

## Tests

`npm test` runs each workspace's test suite (Jest + Supertest for the
API: health check, full middleware-chain smoke test, storage adapter
round-trip + path-traversal guard).

## Status

**Sprint 0 — Foundations & scaffolding.** Module skeletons exist for the
P0 domains (`auth`, `users`, `cases`, `documents`, `permissions`,
`audit`) with stub routes only — no business logic, no real crypto, no
JWT verification yet. This sprint proves the plumbing: a request reaches
a stub endpoint through the full middleware chain, migrations seed base
reference data, and CI is green. The architecture dossier (see above)
describes what gets built on top of this foundation in later sprints.
