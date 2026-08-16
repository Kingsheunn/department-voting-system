# Verification API

Trusted Node backend for the registration gate. It creates DoJah attempts, verifies signed webhooks, resolves authoritative verification details, and mints Firebase custom tokens only after approval.

## Runtime

- Node.js 20.6 or newer
- `firebase-admin` 14.2.0
- Application Default Credentials for the Firebase project
- Firestore in production; the in-memory store is limited to tests and local development

Required environment variable names:

- `DOJAH_APP_ID`
- `DOJAH_BASE_URL` (`https://sandbox.dojah.io` or `https://api.dojah.io`)
- `DOJAH_PRIVATE_KEY`
- `DOJAH_WIDGET_ID` or `NEXT_PUBLIC_DOJAH_WIDGET_ID`
- `DOJAH_WEBHOOK_SECRET` when the webhook secret differs from the private key
- `DOJAH_ALLOWED_DOCUMENT_TYPES` as a comma-separated, exact allowlist
- `DOJAH_VERIFICATION_CONTRACT_CONFIRMED` (`true` only after a signed sandbox fixture confirms the contract)
- `ACCOUNT_PROVISIONING_ENABLED` (defaults to `false`)
- `FIREBASE_PROJECT_ID` when Firestore or account provisioning is enabled
- `FIREBASE_AUTH_EMULATOR_HOST` for sandbox account provisioning; omit the protocol
- `PRODUCTION_INGRESS_RATE_LIMIT_CONFIRMED=true` after production ingress limiting is configured
- `NODE_ENV` (`development`, `test`, or `production`)
- `STORE_DRIVER` (`firestore` or `memory`)
- `PORT`

The process does not load dotenv files. Supply secrets through the deployment platform. Never prefix a private key with `NEXT_PUBLIC_` or `VITE_`.

## Commands

```sh
npm install
npm test
npm run dev
npm start
```

For local reviewer testing, start the Firebase Auth Emulator and run
`npm run seed:dummy-reviewer` with `NODE_ENV=development`,
`FIREBASE_PROJECT_ID=demo-department-voting`, a loopback
`FIREBASE_AUTH_EMULATOR_HOST`, and a runtime-only
`DUMMY_REVIEWER_PASSWORD` of at least 12 characters. The seed script creates
only `dummy.reviewer@local.test` with the reviewer claim; it cannot run against
a production or non-demo Firebase project and does not grant the administrator
claim.

`npm run dev` explicitly loads the repository-root `.env.local`; `npm start`
uses only the process environment supplied by the deployment platform. Copy
`.env.example` for variable names, but never commit real credentials.

## HTTP surface

- `POST /v1/verification-attempts`
- `GET /v1/verification-attempts/:id`
- `POST /v1/verification-attempts/:id/exchange`
- `POST /v1/webhooks/dojah`

Attempt status and exchange require the claim token returned at creation. The store retains only its SHA-256 hash, and the single-use credential expires after 24 hours. Firebase UID reservations are transactionally keyed by a normalized-email fingerprint so repeat verification for one email cannot create competing accounts. All responses use `Cache-Control: no-store`.

Approval requires an authoritative completed DoJah result, the exact verified
school email, and the documented dedicated liveness verdict
`entity.liveness.liveness_check` with a probability above the configured
threshold. Standard identity documents also require an exact allowlist match
for `data.id.data.id_data.document_type`; a custom student-card upload can only
enter protected manual review after the non-human checks pass. Until
`DOJAH_VERIFICATION_CONTRACT_CONFIRMED=true`, completed results remain in
`pending_review`. Account provisioning is independently disabled by default.
Sandbox provisioning requires the Firebase Auth Emulator; production
provisioning requires the production DoJah host and Firestore.
The field paths follow DoJah's [verification-details reference](https://docs.dojah.io/docs/technical-reference/get-verification-details).
Each attempt snapshots its contract, document allowlist, and provider
environment, so later configuration changes cannot retroactively approve it.
Successful exchange consumes the claim credential; a transient Firebase
provisioning failure releases the reservation for a safe retry.

The process applies a small per-address fixed-window attempt limiter as
defense-in-depth. Production still requires a distributed ingress rate limit.
Attempts and reference-index records receive a Firestore-compatible
`deleteAfter` date set 24 hours ahead. Enable Firestore TTL separately on that
field for both collections; writing the field does not activate TTL deletion.

The API does not subscribe to a webhook service name because DoJah's current documentation uses conflicting spellings. Confirm the sandbox dashboard value before registration. A real signed sandbox webhook must become a regression fixture before production approval is enabled.
