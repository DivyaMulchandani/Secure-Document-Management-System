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
- **Auth**: JWT access tokens + opaque httpOnly-cookie refresh tokens,
  scrypt password hashing, TOTP MFA (`otplib`)
- **Mail**: `nodemailer` → MailHog in dev (invitation emails)
- **Audit**: hash-chained `audit_events` ledger + `security_events`
  (feeds the admin security dashboard, future sprint)
- **Crypto (future sprints)**: AES-256-GCM (documents), SHA-256
  (integrity), RSA-SHA256 (signatures) — password hashing (scrypt) is
  already real, see Auth above
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
   seeds `roles`, `permissions`, `document_types`, and a bootstrap
   `ADMINISTRATOR` user (runs inside the `api` container, which already
   has `DATABASE_URL` and `BOOTSTRAP_ADMIN_USERNAME`/`_EMAIL`/`_PASSWORD`
   from `.env` via `env_file`). The bootstrap-admin seed migration reads
   those three vars directly from `process.env`, not via `src/config`, so
   they must be present in whatever shell/container actually runs
   `migrate:up` — not just in the API's own runtime env.
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

`npm test` runs each workspace's test suite. The API's Jest/Supertest
suite includes real integration tests (`auth.test.js`, `users.test.js`)
that run against a real, migrated Postgres — `DATABASE_URL` must point
at a database that already had `migrate:up` run against it (including
the bootstrap-admin seed), same as CI's own `migrate:up` → `npm test`
sequence.

## Status

**Sprint 1 — Auth, identity, RBAC, users.** `auth` and `users` are real:
an admin invites a user (real email via MailHog, or the activation
link/token returned inline outside production), the invitee activates,
logs in (scrypt + JWT, optional TOTP MFA), and is locked out after
`AUTH_LOCKOUT_THRESHOLD` consecutive failures — with a real
`security_events` row and a verifiable `audit_events` hash chain to
show for it. `cases`, `documents`, and `permissions` (the full
case/resource-scoped permission engine — this sprint only implements
RBAC-role checks) are still Sprint-0 stubs. The architecture dossier
(see above) describes what gets built on top of this foundation next.
