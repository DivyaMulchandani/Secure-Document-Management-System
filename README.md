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
- **Signatures & verification**: RSA-2048/SHA-256 signing
  (`services/crypto.generateRsaKeyPair`/`signRsa`/`verifyRsa`), a
  private key never leaving the server unencrypted (AES-256-GCM
  envelope, same master key as document content), and a
  self-sign-or-request-and-queue workflow (`document_signatures`
  doubles as the pending-signature queue). The verification portal runs
  four independent checks — content hash, RSA signature validity, the
  global audit ledger's integrity, and whether the signed version is
  still current — both for authenticated users
  (`GET /verification/documents/:id`) and for anyone holding a
  document's public verification code, no account needed
  (`GET /verification/public/:code`), logging every check to
  `verification_records`.
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
6. Browse the database at **http://localhost:5050** (pgAdmin, dev-only —
   `docker compose up -d pgadmin`). No login screen (desktop mode); the
   "Secure DMS (docker)" server is pre-registered, it just prompts once
   for the Postgres password (`DB_PASSWORD` in `.env`).

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

**Sprint 5 — Signatures & verification portal.** `signatures` and
`verification` are real: RSA-2048/SHA-256 signing bound to a specific
document VERSION's hash (`document_signatures.signed_hash`, frozen at
sign time — later edits to the document don't retroactively change
what a past signature attests to), a self-service signing key per user
(`user_keys`, one ACTIVE key at a time, rotation-ready, private key
never stored or returned in the clear), and a signing workflow that
doubles as the "pending-signature queue": sign your own document
directly, or request someone else's signature and it shows up in their
queue (`GET /signatures/queue`) until they sign or decline. The
verification portal runs four independent checks — re-hash the stored
content, cryptographically verify the RSA signature, recompute the
*entire* global audit hash chain, and confirm the signed version is
still current — producing `AUTHENTIC`, `TAMPERED`, or (a signature
that's genuine but the document has since moved on) `SUPERSEDED`. The
literal "done when" bar: an untampered signed document verifies
`AUTHENTIC` on all four checks, both internally
(`GET /verification/documents/:id`) and through the public,
unauthenticated external-verifier path
(`GET /verification/public/:code`) — and a tampered one is flagged
`TAMPERED` through both paths too, every check logged to
`verification_records`. `PERMISSIONS.SIGN` picked up the same
latent-gap fix `VERIFY` got in Sprint 4: it's now granted to every
case role that the Role Capability Matrix allows, closing a gap where
no case-scoped document could ever actually be signed. Frontend: a
signing screen and verification-check panel on the document detail
page, a dedicated pending-signature queue page with self-service key
generation, and a public verification portal (`/verify`,
`/verify/[code]`) that works without logging in. `sharing` and
`approval` (the remaining P1 modules) are still ahead. The architecture
dossier (see above) describes what gets built on top of this
foundation next.
