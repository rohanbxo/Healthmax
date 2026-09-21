# M6 — Web foundation

Commits: `feab153`, `a8b548c`

## What this adds

- Vite + React 18 + React Router + TanStack Query + Tailwind, with the
  SPEC.md §4 tokens and Geist / Geist Mono.
- An owned shadcn/ui layer on those tokens: Button, Card, Row, Field, Input,
  Switch, Sheet, AlertDialog, SegmentedControl, Toast, ProgressSegments,
  Spinner, SectionLabel, Badge (`feab153`).
- The API client: same-origin `fetch`, bearer token from memory, schema
  parsing in development builds, and a **single-flight refresh** on 401 —
  concurrent callers await the same promise, retry once, and a second failure
  ends the session.
- `AuthProvider`, route guards, the app shell with its bottom tab bar.
- Login, register and onboarding screens.
- MSW handlers, a fixed clock and a render helper for the web tests.

## Acceptance criteria (SPEC.md §15)

- [x] Vite + React + Router + Query + Tailwind + shadcn/ui with tokens/fonts
- [x] API client with single-flight refresh
- [x] Login, register, onboarding; route guards
- [x] Web tests for the auth client and the redirect

## The bug this shipped, found in M9

**The app rendered a blank page in a real browser.** `@beta/core` builds to
CommonJS, because the API runs it that way, and Vite does not pre-bundle a
linked workspace package — so every `import { … } from '@beta/core'` failed
at runtime:

```
SyntaxError: The requested module '/@fs/app/packages/core/dist/index.js'
does not provide an export named 'apiErrorSchema'
```

Nothing caught it for three milestones because the web suite runs in jsdom,
where Vitest performs its own CommonJS interop. The screens were tested;
the browser's module loader never was. Fixed in `0fec58f` with
`optimizeDeps.include: ['@beta/core']`.

That is why M7 onwards verify in Chrome against the running stack.

## Known limitations

- The web app is same-origin with the API in every environment, so there is
  no CORS configuration anywhere — a deliberate constraint, not an omission.
