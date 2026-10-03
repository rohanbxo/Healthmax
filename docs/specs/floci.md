# Spec: Local AWS (S3 + SES) with Floci

> Paste this into Claude Code from the repo root, or save it as `docs/FLOCI_SPEC.md` and tell Claude Code: "Implement docs/FLOCI_SPEC.md".

---

## Context

This repo ("Beta", a habit tracker) is a pnpm monorepo: `apps/api` (Express 5, Prisma, Postgres, Redis, BullMQ), `apps/web` (React 18 PWA), and `packages/core` (pure domain logic). Local development runs entirely in Docker Compose (`pnpm dev`).

Goal: add **real AWS services, emulated locally with Floci**, so the full stack (including cloud services) runs on a laptop with one command, for free, with no AWS account. The same code must work against real AWS in production by changing only environment variables.

Floci facts (verified from floci.io docs):

- Image `floci/floci`, AWS endpoint on port **4566**, accepts any dummy credentials (no auth token).
- SES v1 and v2 `SendEmail` are supported. Identity verification succeeds instantly.
- Sent emails are captured and visible at `GET http://localhost:4566/_aws/ses` (`DELETE` clears them).
- SES can relay to a real SMTP server via `FLOCI_SERVICES_SES_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_STARTTLS`.
- State is disposable: restarting Floci resets it.

## Before writing code

1. Read `README.md`, `SPEC.md`, `docker-compose.yml`, `.env.example`, `apps/api/src/config.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`, `apps/api/src/lib/mailer.ts`, `apps/api/src/jobs/emailWorker.ts`, the `apps/api/src/modules/transfer/` module, and `apps/api/test/helpers/testApp.ts`.
2. Follow the existing conventions exactly: zod-validated config, dependency injection through `createApp(deps)`, the repository/service/controller/routes/openapi module layout, typed errors from `http/errors.ts`, fakes for tests, and Conventional Commits.
3. Post a short implementation plan and wait for my approval before changing files.

---

## Part 1: Docker Compose

Add three services to `docker-compose.yml`:

### `floci`

- Image `floci/floci`, **pinned to the current release tag** (not `latest`). State the tag you chose.
- Host port `4566:4566`.
- SMTP relay env vars pointing at `mailpit` (port 1025, STARTTLS disabled).
- A healthcheck. Use Floci's documented health endpoint; if none exists, check that port 4566 accepts connections.

### `mailpit`

- Image `axllent/mailpit`, pinned.
- Ports `8025:8025` (web inbox UI). SMTP 1025 stays internal.
- Purpose: emails sent through SES appear in a real inbox UI at http://localhost:8025. This demonstrates SMTP.

### `aws-init` (one-shot, like `migrate`)

- Image `amazon/aws-cli`, pinned.
- Runs `scripts/floci-init.sh` (new file) against `http://floci:4566` with dummy credentials `test`/`test` and region `us-east-1`.
- The script must be **idempotent** and must:
  1. Create the S3 bucket `beta-exports` (skip if it exists).
  2. Block all public access on the bucket.
  3. Add a lifecycle rule expiring objects under `exports/` after 1 day. If Floci rejects this call, log a warning and continue.
  4. Verify the sender identity from `EMAIL_FROM` in SES.
  5. Print a short summary (`aws s3 ls`, `aws ses list-identities`).
- `api` and `worker` must `depends_on` `aws-init` with `service_completed_successfully`.

---

## Part 2: Configuration

Extend the zod config in `apps/api/src/config.ts` and `.env.example`:

| Variable                                      | Default     | Purpose                                                                                                        |
| --------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`                              | `none`      | `resend` \| `ses` \| `none`                                                                                    |
| `AWS_REGION`                                  | `us-east-1` |                                                                                                                |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | unset       | `test`/`test` locally; unset in production (use the default credential chain)                                  |
| `AWS_ENDPOINT_URL`                            | unset       | `http://floci:4566` in Compose. **Unset means real AWS.**                                                      |
| `AWS_PUBLIC_ENDPOINT_URL`                     | unset       | `http://localhost:4566`. Used only to sign URLs the browser opens, because the browser cannot resolve `floci`. |
| `S3_EXPORT_BUCKET`                            | unset       | `beta-exports` locally. Unset disables cloud export.                                                           |
| `EXPORT_URL_TTL_SECONDS`                      | `900`       | Presigned URL lifetime                                                                                         |

Rules:

- `EMAIL_PROVIDER=resend` requires `RESEND_API_KEY` and `EMAIL_FROM`; `ses` requires `EMAIL_FROM`. Fail at startup with a clear message otherwise.
- Keep backward compatibility: if `EMAIL_PROVIDER` is unset but `RESEND_API_KEY` is set, behave exactly as today.
- Set the Compose defaults in the `x-api-env` anchor so a clean checkout uses Floci with zero setup.
- Never log credentials.

---

## Part 3: SES mailer

- Add `SesMailer implements Mailer` in `apps/api/src/lib/mailer.ts` (or a sibling file), using `@aws-sdk/client-sesv2` `SendEmailCommand`.
- Construct the SES client with `endpoint` only when `AWS_ENDPOINT_URL` is set.
- On failure, throw an `Error` that includes the AWS error name and message but **not** the recipient address or email body (match the existing Resend error-handling comment).
- Update `createMailer` in `server.ts` to choose `ResendMailer`, `SesMailer`, or the existing "disabled" mailer from `EMAIL_PROVIDER`.
- No changes to `emailWorker.ts` or the forgot-password flow should be needed. If any are, explain why.

---

## Part 4: S3 cloud export

### Object store seam

- New `apps/api/src/lib/objectStore.ts`:
  ```ts
  export interface ObjectStore {
    putJson(key: string, body: unknown): Promise<void>;
    presignGet(key: string, ttlSeconds: number): Promise<string>;
  }
  ```
- `S3ObjectStore` using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`:
  - `forcePathStyle: true` when an endpoint is set.
  - Uploads with `ContentType: application/json`, `ServerSideEncryption: AES256`.
  - **Presigns with a second client configured with `AWS_PUBLIC_ENDPOINT_URL`** (when set) so links work in the browser.
- `FakeObjectStore` for tests that records puts and returns deterministic URLs.
- Add `objectStore: ObjectStore | undefined` to `createApp(deps)` and wire it in `server.ts` and `test/helpers/testApp.ts`.

### Endpoint

- `POST /api/export/cloud` (authenticated), in the existing `transfer` module.
- Reuse `TransferService.export(userId)` to build the payload; do not duplicate export logic.
- Object key: `exports/{userId}/{ISO timestamp}-{uuid}.json`. The time comes from the injected `Clock`.
- Response `201`: `{ "url": string, "expiresAt": string, "key": string }`.
- If `objectStore` is undefined, return `503` with a clear message, the same way push reports itself as off.
- Rate limit with the existing rate-limit helper: 5 requests per user per hour.
- Add zod schemas and OpenAPI docs like the other routes, so it shows in `/api/docs`.
- Keep the existing `GET /api/export` exactly as it is.

### Web

- In `apps/web/src/components/DataSettings.tsx`, add a "Save export to cloud" button next to the existing export.
- On success, show the link and its expiry time. On `503`, hide the button or show "Cloud export is not configured."
- Add a TanStack Query mutation in `apps/web/src/api/hooks.ts` and an MSW handler for tests.

---

## Part 5: Tests

- **Unit / API tests (always run):** use `FakeObjectStore` and `FakeMailer`. Cover: success, `503` when disabled, auth required (`401`), user A cannot obtain user B's export, rate limit, key format, and config validation for each `EMAIL_PROVIDER` value.
- **Integration tests against Floci (opt-in):** `apps/api/test/floci.integration.test.ts`, run only when `FLOCI_TESTS=1`:
  - Upload via `S3ObjectStore`, fetch the presigned URL, and assert the JSON round-trips.
  - Send via `SesMailer`, then assert the message appears at `GET /_aws/ses`, and clear it afterwards.
- **Web tests:** the new button's success and disabled states.
- `pnpm check` must pass with no new lint or type errors and no reduction in coverage.

## Part 6: CI

In `.github/workflows/ci.yml`, add a Floci service container to the `test-api` job and run the integration tests with `FLOCI_TESTS=1`. If the bucket must exist first, run the init script in a step.

## Part 7: Documentation

Add a **"Local AWS with Floci"** section to `README.md`:

1. A short paragraph on why: real AWS APIs locally, free, offline, and production needs only env var changes.
2. An updated architecture diagram including Floci (S3, SES) and Mailpit.
3. A **terminal demo script** I can run in interviews:
   ```bash
   aws --endpoint-url http://localhost:4566 s3 ls s3://beta-exports --recursive
   aws --endpoint-url http://localhost:4566 ses list-identities
   curl -s http://localhost:4566/_aws/ses | jq
   open http://localhost:8025   # Mailpit inbox
   ```
4. A "Moving to real AWS" table listing exactly which env vars change, and the IAM permissions the app needs (`s3:PutObject`, `s3:GetObject` on the bucket, `ses:SendEmail`).
5. Update the "Skills map" table with a row for AWS (S3, SES) and SMTP.

---

## Constraints

- Do not change existing behaviour, routes, or tests except where this spec says so.
- No real AWS credentials anywhere in the repo.
- Pin every new Docker image and npm dependency.
- One Conventional Commit per part (e.g. `feat(infra): add floci, mailpit and aws-init to compose`).
- If Floci does not support something this spec needs, stop and tell me instead of working around it silently.

## Acceptance criteria

- [ ] From a clean checkout, `pnpm dev` starts everything including Floci, Mailpit and the one-shot init, with no manual steps.
- [ ] "Forgot password" sends an email that appears at `/_aws/ses` and in Mailpit at http://localhost:8025.
- [ ] "Save export to cloud" in Settings returns a link that downloads the export JSON in the browser.
- [ ] `aws --endpoint-url http://localhost:4566 s3 ls s3://beta-exports --recursive` lists the uploaded export.
- [ ] Removing `AWS_ENDPOINT_URL` and setting real credentials would target real AWS with no code changes.
- [ ] `pnpm check` passes locally and in CI, including the Floci integration job.
- [ ] README demo commands work exactly as written.
