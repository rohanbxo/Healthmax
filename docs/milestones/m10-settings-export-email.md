# M10 — Settings, export/import, email

Commits: `d423b49`, `cf81787` (plus the CI fixes `d618da1`, `27afc0c`,
`b8e6f31` made when the repository first got a remote)

## What this adds

- `GET /api/export`: the caller's habits and logs as an attachment, in the
  same DTO shapes the rest of the API uses, so the file can be handed
  straight back.
- `POST /api/import`: replaces everything in **one transaction**. A file that
  fails part way leaves the account exactly as it was. A log naming a habit
  the file never defines is refused as 422 with a reason rather than left to
  the foreign key. `me` in the file is ignored — an import cannot change who
  you are or reach another account's rows.
- The `send-email` worker, consuming the queue M4 already wrote to, so
  forgot-password still answers 204 immediately while the message goes out
  behind it. It logs the subject and never the body, because a reset link in
  a log is a live credential.
- Settings: name, time zone and week start saving themselves 500ms after you
  stop typing, with a live status line; notifications; export; import with a
  confirmation naming what it will write; sign out; delete account behind a
  password.
- The last `MilestonePlaceholder` is gone — every screen is real.

## Acceptance criteria (SPEC.md §15)

- [x] Settings screen with auto-save
- [x] Export/import (atomic)
- [x] Forgot/reset password via the `send-email` queue job
- [x] Delete account
- [x] Tests

## Two bugs the tests caught, both real

1. **Radix closes an `AlertDialog` on its action button**, so a wrong
   password dismissed the dialog and the error landed nowhere. The delete
   action now prevents the default close and closes only on success.
2. **`DELETE /me` answered 401 for a wrong confirmation password.** That is
   indistinguishable from an expired session, and the client signs the user
   out whenever it sees one — so a typo logged you out. It is **422** now:
   the token is valid, the rules refused the request. The API test and the
   OpenAPI document were updated with it.

## Decisions the spec left open

- **Habit ids on import.** They are kept when free — so re-importing your own
  export returns it unchanged, which is what "round trip equality" means —
  and remapped when they belong to another account, which is what lets a file
  move to a new account without colliding on the primary key. Logs follow the
  rename.
- `FileReader` rather than `Blob.text()`: the test environment does not
  implement the latter.

## The first real CI run

The repository had no remote until after this milestone, so CI had never
executed. Its first three runs failed:

1. `ERR_PNPM_BAD_PM_VERSION` — `pnpm/action-setup` pinned `version: 9` while
   `package.json` declares `packageManager: pnpm@9.15.9`.
2. A corrupt workflow file, from a PowerShell edit where a backtick-`v` is a
   vertical-tab escape and control characters landed in the YAML.
3. `Cannot find dependency '@vitest/coverage-v8'` — both Vitest configs had
   asked for `provider: 'v8'` since M0 without the package installed, because
   coverage only runs in CI.

Green on the fourth: all four jobs pass, coverage is **core 96.8%** and
**web 89.8%** lines, and the JUnit and coverage artifacts upload. The API job
passing also confirms the `DATABASE_URL` fix works against GitHub's service
containers.

## Verified in Chrome, against the running stack

Settings renders all four sections; changing the week start fired
`PATCH /api/me` → 200 and the status line read "Saved"; the delete
confirmation opens and cancels cleanly.

## Known limitations

- **No email has ever been delivered.** `RESEND_API_KEY` is empty, so the
  worker has only been proven against `FakeMailer` and a real queue.
- Import remaps habit ids when they belong to another account, so a file
  imported elsewhere returns different ids than it carried.
