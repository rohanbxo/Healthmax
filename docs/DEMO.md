# Interview demo: local AWS with Floci

A live walkthrough of Beta's cloud features (SES email and S3 cloud export),
which are developed and tested against AWS APIs emulated locally by Floci.
Beta is not deployed on AWS and there is no AWS account; moving to AWS is a
documented plan. Target: **under 5 minutes**.
The design is in [README "Local AWS with Floci"](../README.md#local-aws-with-floci)
and the original spec in [`specs/floci.md`](specs/floci.md).

All terminal commands are bash (Git Bash on Windows).

---

## Before the interview (not timed, ~3 minutes)

**1. Start the stack** and wait until everything is healthy. A cold start
takes 30–50 seconds once the images are built.

```bash
pnpm dev
```

In a second terminal:

```bash
docker compose ps --all
```

All long-running services show `(healthy)`; `core-build`, `migrate` and
`aws-init` show `Exited (0)`.

**2. Check the terminal tools.** The demo uses the AWS CLI v2 with a `floci`
profile, which points at `http://localhost:4566` with Floci's dummy `test`/`test`
credentials, plus `jq`. One-time setup, if the profile is missing:

```bash
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

Then check that it reaches Floci (it lists `beta-exports`):

```bash
aws --profile floci s3 ls
```

_Backup only_, for a machine without the AWS CLI or `jq`: these run the same
pinned CLI image Compose uses, reading the same `floci` profile.

```bash
command -v aws >/dev/null || aws() { MSYS_NO_PATHCONV=1 docker run --rm -i --network host -v "$(cygpath -m "$HOME/.aws" 2>/dev/null || echo "$HOME/.aws"):/root/.aws:ro" amazon/aws-cli:2.37.9 "$@"; }
command -v jq >/dev/null || jq() { python -m json.tool; }
```

**3. Create the demo account**, already onboarded (a `409` on re-runs is fine):

```bash
B=http://localhost:5173/api
curl -s -o /dev/null -w "register %{http_code}\n" -X POST $B/auth/register -H 'content-type: application/json' \
  -d '{"email":"demo@beta.test","password":"demo-password-2026","name":"Demo","timeZone":"Asia/Dubai"}'
TOKEN=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@beta.test","password":"demo-password-2026"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s -o /dev/null -w "onboard %{http_code}\n" -X PATCH $B/me -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"onboarded":true}'
```

**4. Reset anything a rehearsal left behind.** This clears the rate limits:
forgot-password allows 3 an hour, and every browser request reaches the API
through the Vite proxy with the same IP. It also empties both mailboxes.

```bash
docker compose exec redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"
curl -s -X DELETE http://localhost:4566/_aws/ses -o /dev/null
curl -s -X DELETE http://localhost:8025/api/v1/messages -o /dev/null
```

**5. Open the tabs**, in this order:

1. http://localhost:5173/login (signed out)
2. http://localhost:8025 (Mailpit)
3. http://localhost:5173/api/docs (Swagger)

**6. Check the sender.** The sender is `EMAIL_FROM` from your root `.env`, and
it should be `Beta <noreply@beta.local>`. If it names a Resend address, emails in
an SES demo look like they came from Resend: fix it and run `pnpm dev` again.

> Don't restart Floci between steps 3 and 4 of the demo. Its state is
> disposable: a restart empties the bucket.

---

## The demo (~4½ minutes)

### 1. One command, AWS APIs on a laptop (30 s)

**Do:**

```bash
docker compose ps --all
```

**They see:** Postgres, Redis, the API, the worker, the web app, **Floci** and
**Mailpit**, all healthy; `aws-init` exited 0.

**Say:** "`pnpm dev` brings up the whole stack, including the S3 and SES APIs
emulated locally by Floci, so I build and test against the same APIs and SDK
I'd use on AWS, with no account. A one-shot AWS CLI container creates the bucket
and verifies the sender, so a clean checkout needs no setup."

### 2. Forgot password → SES → inbox (60 s)

**Do:** Tab 1 → **Forgot your password?** → email `demo@beta.test` → **Send
reset link**. Switch to the Mailpit tab, then run:

```bash
curl -s http://localhost:4566/_aws/ses | jq
```

**They see:**

- The page says _"If that address has an account, we sent a link."_
- "Reset your Beta password" lands in Mailpit within about a second.
- `/_aws/ses` shows the same message with `Destination` and `Subject`.

**Say:** "The email worker didn't change when I added SES. It talks to a
`Mailer` interface, and config picks Resend, SES or nothing, so SES was one new
class. Floci captured the message and relayed it over real SMTP to Mailpit."

### 3. Save export to cloud → presigned link (75 s)

**Do:** Tab 1 → sign in as `demo@beta.test` / `demo-password-2026` →
**Settings** → **YOUR DATA** → **Save export to cloud**. Click **Download
link**.

**They see:** a download link with _"Link expires at HH:MM"_ 15 minutes ahead.
The link opens the export JSON straight from `localhost:4566`, not from the API.

**Say:** "The API uploads with one S3 client and signs the link with a
second one. Inside Docker the API reaches Floci as `floci:4566`, but the
browser only knows `localhost:4566`, and a SigV4 signature covers the host. So
I can't sign once and rewrite the URL; the second client signs for the public
host. Signing is pure local crypto, with no network call."

### 4. It's really in S3 (30 s)

**Do:**

```bash
aws --profile floci s3 ls s3://beta-exports --recursive
```

**They see:** `exports/<userId>/<timestamp>-<uuid>.json`.

**Say:** "Keys are scoped by user and timestamped. Objects are encrypted at
rest, the bucket blocks all public access, and a lifecycle rule deletes
exports after a day."

### 5. The link is the only way in (30 s)

**Do:**

```bash
KEY=$(aws --profile floci s3 ls s3://beta-exports --recursive | sort | tail -1 | awk '{print $4}')
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4566/beta-exports/$KEY"
```

**They see:** `403`.

**Say:** "Floci doesn't check signatures by default. Until I turned that on,
this unsigned request returned the file despite the public access block. Now
local S3 refuses it the way S3 is documented to, and CI has an integration
test that proves a tampered link is rejected."

### 6. The contract (30 s)

**Do:** Tab 3 (Swagger) → **transfer** → expand **POST /api/export/cloud**.

**They see:** responses `201`, `401`, `404` and `429`.

**Say:** "The docs are generated from the same zod schemas that validate
requests. It's limited to 5 per user per hour, and without a bucket it answers
404 'not configured', the same pattern push uses."

### 7. The plan for real AWS (20 s)

**Do:** show "Moving to real AWS: the plan" in the README (or the AWS block of
`x-api-env` in `docker-compose.yml`).

**They see:** the endpoint and key variables set for Floci, and the plan's
column where they'd be unset.

**Say:** "To be clear, this has only ever run against Floci; there's no AWS
account. But it's built so moving is configuration, not code: unset
`AWS_ENDPOINT_URL` and the keys, and the SDK would use the regional endpoints
and an IAM role. I've written down the minimal policy that role would need:
`s3:PutObject` and `s3:GetObject` on `exports/*`, plus `ses:SendEmail`."

---

## If something breaks during the demo

| Symptom                                                                                      | Quick fix                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A service is `unhealthy` or `Exited (1)`                                                     | `docker compose logs <service> --tail 30`; then `docker compose up -d --wait`                                                                                            |
| API logs `Cannot find module '@aws-sdk/…'`                                                   | The dependency volumes are stale (README "Run it locally"): `docker compose down`, remove the four `beta_beta_*node_modules` volumes, `docker compose build && pnpm dev` |
| "Forgot password" shows an error or no email arrives (429 in the network tab)                | Rate limit from rehearsals: `docker compose exec redis sh -c "redis-cli --scan --pattern 'rl:*' \| xargs -r redis-cli del"`                                              |
| Email in `/_aws/ses` but not in Mailpit                                                      | The SMTP relay failed: `docker compose logs floci --tail 30` and `docker compose ps mailpit`; `/_aws/ses` alone still proves SES sent it                                 |
| **Save export to cloud** says "We could not save your export…" with "Too many cloud exports" | 5 per user per hour: clear the rate limits (row above)                                                                                                                   |
| "Cloud export is not configured."                                                            | `S3_EXPORT_BUCKET` is unset: check `.env` doesn't blank it, then `pnpm dev`                                                                                              |
| Download link returns `403` or `404` in the browser                                          | It expired (15 minutes), or Floci restarted and lost the object: press **Save export to cloud** again                                                                    |
| `s3 ls` is empty                                                                             | Floci restarted (state is disposable). Do step 3 again, then step 4                                                                                                      |
| `The config profile (floci) could not be found`                                              | Run the four `aws configure set … --profile floci` lines from prep step 2                                                                                                |
| `aws: command not found` / `jq: command not found`                                           | Open a new terminal (the installers update `PATH`), or define the backup functions from prep step 2                                                                      |
| Port already in use on `pnpm dev`                                                            | Something else holds 4566, 8025, 5173 or 4000: `docker ps` and stop it                                                                                                   |

If the browser part fails outright, steps 2–5 also work from the terminal. The
README demo block and the integration tests (`FLOCI_TESTS=1 pnpm --filter
@beta/api test`) show the same behaviour.
