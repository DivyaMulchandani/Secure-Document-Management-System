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
- **Audit**: hash-chained `audit_events` ledger (append + verify +
  filtered listing + CSV export are real) + `security_events` (feeds
  the admin security dashboard, future sprint)
- **Access control**: three-layer engine — RBAC role ceiling, case
  scope (`case_members`), and expiring per-resource grants
  (`resource_permissions`) — see `services/permissions`
- **Documents**: AES-256-GCM encryption + SHA-256 integrity, both real
  (`services/crypto`) — every access decrypts, re-hashes, and compares
  against the recorded hash before serving bytes. RSA-SHA256 signatures
  are still a future sprint. Uploads via `multer` (memory storage,
  configurable size/MIME limits).
- **Evidence & chain of custody**: `evidence` + `evidence_artifacts` +
  a tamper-evident, per-evidence-item hash-chained `custody_events`
  ledger (`services/custody-ledger`, independent of the global audit
  chain). Register → seal → verify → transfer → accept/reject, with
  every artifact re-hashed and compared on every hand-off; a failed
  integrity check on receipt blocks the transfer, keeps the item
  `IN_TRANSIT`, and raises a `security_events(CUSTODY_VIOLATION)` row.
  Every custody action also writes a global `audit_events` row.
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
suite includes real integration tests (`auth.test.js`, `users.test.js`,
`cases.test.js`, `audit.test.js`, `documents.test.js`) that run against
a real, migrated Postgres — `DATABASE_URL` must point at a database
that already had `migrate:up` run against it (including the
bootstrap-admin seed), same as CI's own `migrate:up` → `npm test`
sequence. `documents.test.js` also reads raw bytes off the local
storage disk directly (not through the API) to prove encryption is
real rather than trusting the API's own claims about it.

## Status

**Sprint 4 — Evidence vault & chain of custody.** `evidence` is real:
register → seal → verify → transfer → accept/reject, enforcing the
full evidence state machine (`ALLOWED_TRANSITIONS` in
`evidence.service.js`) and re-verifying every artifact's SHA-256 hash
on every hand-off — not just at upload. Custody is tracked in its own
tamper-evident, hash-chained `custody_events` ledger
(`services/custody-ledger`), scoped per evidence item and independent
of the global `audit_events` chain, with an advisory-lock namespace
that serializes writers per-item rather than globally. The literal
"done when" bar: a two-party transfer (`POST /transfers` →
`POST /transfers/:id/accept`) re-verifies integrity before completing,
and on success writes both a `custody_events(RECEIVE, COMPLETED)` row
and an `audit_events(EVIDENCE_TRANSFER, SUCCESS)` row — an integrity
failure on receipt instead blocks the transfer, raises a
`security_events(CUSTODY_VIOLATION)` row, and leaves the item
`IN_TRANSIT`. Archiving is deliberately decoupled from physical
custody (case-closure action, not a hand-off) so it isn't blocked by
whichever role happens to be holding the item last. The permission
engine's `CASE_ROLE_ACTIONS` also picked up a latent-gap fix this
sprint: `VERIFY` is now granted to every case role (the matrix's
"verify integrity/custody: all roles" row was never actually wired to
a guarded route until evidence's `/verify` and `/custody/verify`).
Frontend: evidence registration, an artifact list with re-verified
downloads, a chain-of-custody timeline, and transfer request/accept/
reject UI, all wired into the case workspace and a new evidence detail
page — same design system as the rest of the app. `signatures`,
`sharing`, `verification`, and `approval` (the remaining P1 modules)
are still ahead. The architecture dossier (see above) describes what
gets built on top of this foundation next.
