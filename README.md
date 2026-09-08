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
  against the recorded hash before serving bytes. Uploads via `multer`
  (memory storage, configurable size/MIME limits).
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
- **Sharing & approval**: `document_shares` is a document-focused front
  end for the SAME `resource_permissions` primitive the three-layer
  engine's layer 3 already enforced since Sprint 2 — sharing invents no
  second access-control mechanism, so time-limited grants auto-expire
  for free (once `expires_at` passes, the existing engine simply stops
  matching, no scheduler needed) and every existing document
  view/download route enforces a share exactly like it enforces any
  other grant. `approval_requests`/`approval_steps` drive a sequential,
  named-approver-chain review (draft → review → approve/reject/revise)
  that finally activates the `documents.status` values (`UNDER_REVIEW`,
  `APPROVED`, `FINAL`) that had sat unused in the schema since Sprint 3.
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
suite (14 files, 135 tests as of Sprint 6 — one per module, matching
`apps/api/src/modules/`) runs as real integration tests against a real,
migrated Postgres — `DATABASE_URL` must point at a database that
already had `migrate:up` run against it (including the bootstrap-admin
seed), same as CI's own `migrate:up` → `npm test` sequence.
`documents.test.js` also reads raw bytes off the local storage disk
directly (not through the API) to prove encryption is real rather than
trusting the API's own claims about it. `jest.config.js`'s
`testTimeout` is bumped to 15s — several suites' `beforeAll` hooks do
multiple deliberately-expensive scrypt password hashes (OWASP params)
plus HTTP round trips, and the stock 5s default occasionally isn't
enough under the CPU contention of many suites running back to back
against a containerized Postgres.

## Status

**Sprint 6 — Secure sharing & approval workflow. All P1 features are now
in place — this is a complete, defensible demo end to end.**
`sharing` and `approval` are real. Sharing reuses the exact
`resource_permissions` primitive the three-layer permission engine's
layer 3 has enforced since Sprint 2 — `document_shares` is just a
document-shaped record of who/why on top of it, so a share is auto-
enforced by every existing document route (view/download) with zero new
access-control code, and auto-revoke is free: once `expires_at` passes,
the engine simply stops matching, no scheduler needed. The literal
"done when" bar's first half: a share is grantable to ANY active user
(deliberately not restricted to case members — that's the point of
sharing vs. case membership), and manipulating its underlying grant's
`expires_at` into the past (simulating 72h elapsing) immediately and
correctly denies further access — proven directly against the API in
`sharing.test.js`.

Approval is a sequential, named-approver chain (`approval_requests` +
ordered `approval_steps`) that finally drives the `documents.status`
values (`UNDER_REVIEW`, `APPROVED`, `FINAL`) that had sat unused in the
schema since Sprint 3: submit → each approver gets their turn in order
(an earlier approver's turn can't be skipped) → APPROVED on the last
step moves the document to `APPROVED`; a REJECTED or
REVISION_REQUESTED decision instead halts the chain immediately and
reverts the document to `DRAFT`. The literal "done when" bar's second
half: an approval chain drives a document to `APPROVED`, then Sprint
5's signing flow takes it to `SIGNED`, then a new finalize step
(`POST /approval/documents/:id/finalize`) closes it out at `FINAL` —
verified end to end against the live Docker stack. Both
`PERMISSIONS.SIGN`'s case-role wiring (Sprint 5) and `PERMISSIONS.SHARE`
(already correctly wired since Sprint 2/3) are reused as-is; no new
permission-engine gaps were found this sprint. A small, deliberately
minimal `GET /users/lookup` endpoint (any authenticated user, username-
only) was added to make sharing/approval's "pick a recipient outside
your case" pickers usable without needing admin-only user listing.

Frontend: a share dialog (recipient picker, scope, expiry) and an
approval panel (build an ordered approver chain, decide your turn
inline) on the document detail page, plus two new standalone pages —
an approval inbox (`/approval/inbox`) and a "shared with me" list
(`/sharing/mine`) — both reachable from the top nav. 135 tests passing,
lint clean. The architecture dossier (see above) describes what
remains as post-MVP scope.
