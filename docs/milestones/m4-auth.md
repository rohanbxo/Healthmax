# M4 — Auth

Commit: `e4ff463`

## What this adds

- `POST /auth/register`, `/login`, `/refresh`, `/logout`,
  `/forgot-password`, `/reset-password`; `GET`, `PATCH` and `DELETE /me`.
- argon2id password hashing.
- Access token: JWT HS256, 15 minutes, carrying `{ sub, iat, exp }` only.
- Refresh token: 256-bit random, 30 days, stored hashed, in an httpOnly
  `SameSite=Strict` cookie scoped to `/api/auth`, `Secure` in production.
- **Rotation with reuse detection**: each refresh revokes the old token and
  issues a new one in the same family; presenting an already-revoked token
  revokes the whole family and answers 401.
- `X-Requested-With: beta` required on `/auth/refresh` and `/auth/logout`.
- Redis-backed rate limits: login and register 5/min per IP+email,
  forgot-password 3/hour per IP, 300/min per user globally.
- `forgot-password` always answers 204 and enqueues a `send-email` job when
  the address exists, so the response never reveals whether it does.

## Acceptance criteria (SPEC.md §15)

- [x] All auth + `/me` endpoints, argon2, JWT
- [x] Refresh rotation + reuse detection
- [x] Rate limits
- [x] Full auth tests

## Changed later

`DELETE /me` answered **401** for a wrong confirmation password. That is
indistinguishable from an expired session, and the web client signs the user
out whenever it sees one — so a typo logged you out instead of telling you it
was a typo. M10 changed it to **422**: the token is valid, the rules refused
the request.

## Known limitations

- The `send-email` job had no consumer until M10, so a reset link was
  enqueued and never delivered.
- Delivery of that email is still unverified end to end: `RESEND_API_KEY` is
  empty, so nothing has ever left the machine.
