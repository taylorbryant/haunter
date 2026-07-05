# Beignet feedback from building Haunter

Haunter was built partly to stress-test Beignet. By the end it exercised a
wide slice of the framework: 8+ feature slices, environment-swapped
providers, an auth provider wrapping a large third-party framework (Better
Auth with the organization and agent-auth plugins), non-HTTP entrypoints
(agent capabilities), custom API routes outside contracts (Liveblocks room
auth), a remote libSQL/Turso database, and one real production performance
investigation.

> **Revision note.** This is v2, revised after the framework author's
> response to the original report. Four of the original "gaps" turned out to
> be existing framework APIs; Haunter has since adopted them (details below)
> and those items now record only their accurate residuals. Several other
> items were confirmed and are on the framework roadmap.

## What held up

- **The slice anatomy scales.** Adding the 8th feature felt like adding the
  2nd — `schemas/contracts/ports/use-cases/routes` stayed mechanical, and
  there was never a "where does this go?" debate. The full-slice recipe is a
  good reference artifact.
- **`doctor --strict` earns its keep.** It caught registration drift several
  times; the "silent failure zone" stayed mostly theoretical because the
  check is cheap enough to run constantly.
- **Ports/policy discipline paid off in an unplanned way.** When agent-auth
  needed to execute capabilities from inside a Better Auth plugin callback —
  entirely outside the HTTP pipeline — the fact that use cases only need a
  well-formed `AppContext` made it possible ([lib/agent-capabilities.ts](../lib/agent-capabilities.ts)).
  That's the architecture doing exactly what it promises.
- **Provider swapping is real.** Memory ↔ Upstash rate limiting and local ↔
  Vercel Blob storage are one-ternary changes in
  [server/providers.ts](../server/providers.ts).
- **In-memory repo tests keep the loop honest.** The whole suite runs in
  well under a second, so it actually gets run.
- *(Added in v2)* **The route-test harness carries real weight.**
  `@beignet/web/testing`'s `createTestApp` exercises the same request
  parsing, hooks, and error ownership as production with no network
  listener — Haunter's route tests, including the new hook-coverage ones,
  run in-memory in milliseconds.

## Confirmed gaps, now on the framework roadmap

Per the author's response, these are accepted and planned; Haunter's
mitigations stand in the meantime:

- Per-stage request timings feeding the devtools waterfall (the
  observability half of the context-latency finding below).
- `wrapRawRoute` — reusing the hooks pipeline for non-contract routes.
- A single `beignet check` command replacing the five-command loop.
- Listener auto-fix in `doctor --fix`.
- `PRAGMA foreign_keys = ON` in the sqlite starter.
- A `provider` → `providers` CLI alias.
- A Vercel Blob storage provider (Haunter's hand-written
  [infra/storage/vercel-blob-storage.ts](../infra/storage/vercel-blob-storage.ts)
  can retire when it lands).

## Still-open gaps

### 1. Context creation has no performance story

The biggest real-world finding. `defineServerContext`'s `request` hook
encourages sequential awaits — Haunter's does `getSession` then `findRole`
([server/context.ts](../server/context.ts)) — and every contract call pays
it. With a remote database that was a ~250ms floor on **every** request
before the use case ran, and the app "felt slow in production" until it was
found and mitigated at the app level (Better Auth `cookieCache`, manual
parallelization).

The roadmapped devtools waterfall covers observability. Still open: a
memoization/batching primitive for context resolvers, and guidance on
context latency budgets for serverless + remote-DB deployments (the default
deployment story).

### 2. Escape-hatch routes drop the hooks pipeline

Confirmed by the author; `wrapRawRoute` is roadmapped. Sharpened scope
after review: `@beignet/next` already ships `createWebhookRoute`,
`createPaymentWebhookRoute`, and schedule/outbox/storage/upload route
factories that assemble the full app context (ports, requestId, trace,
logger) — so "raw routes start from nothing" was overstated. What none of
them do is run the configured hooks array, which is why
[app/api/liveblocks-auth/route.ts](../app/api/liveblocks-auth/route.ts)
still enforces its rate limit manually.

### 3. Realtime has no framework story

The entire Liveblocks integration (room auth, env-mode gating, Y.Doc
lifecycle, client-side room caching) was bespoke. That may be the right
call — realtime is opinionated — but even a docs recipe would have saved
time.

### 4. Declarative mutation→query linkage on contracts

The residual of a corrected item (see below): `rq(contract)` already
derives query keys, options, and `invalidate(...)` helpers from contracts,
and Haunter uses them throughout. What doesn't exist is declaring on a
contract which queries a mutation touches, so invalidation could be
automatic instead of imperative in every `onSuccess`.

## Corrected in v2: existing APIs, since adopted

Each of these was originally reported as a gap. The API existed; Haunter
now uses it. What remains under each is the accurate residual ask.

### Service contexts for non-HTTP entrypoints (`createServiceContext`)

The hand-rolled `ports.gate.attach({...})` in agent capabilities is gone.
[server/context.ts](../server/context.ts) now extends the app-owned service
input with `asUser` impersonation (verified role, synthetic session,
mirrored request-context shape), and
[lib/agent-capabilities.ts](../lib/agent-capabilities.ts) builds agent
contexts with `server.createServiceContext({ asUser, tenantId })` — the
framework owns requestId, trace, and gate attachment. Verified end to end:
member search works, non-members still 403.

**Residual:** the framework ships no built-in impersonation input and the
recipe (extend `ServiceInput`, mirror the request seed's shape) is
undocumented. For scripts/seeds, `runServiceContext` is the right entry and
also deserves a documented example.

### Reaching ports from the auth layer

[lib/mail.ts](../lib/mail.ts) no longer maintains a standalone Resend
client: it dynamically imports the memoized `getServer` (same
cycle-breaking pattern as agent capabilities) and sends through
`ports.mailer`, logging through `ports.logger`. Worst case is one server
boot when a sign-in arrives before any contract route has run. Verified:
OTP requests emit structured pino lines and deliver through the configured
provider.

**Residual:** no example app demonstrates wiring a Better Auth callback to
`ports.mailer`, and the pattern is undocumented. A nicer shape might be the
auth provider handing ports into the Better Auth config directly.

### Route-level hook testing (`@beignet/web/testing`)

The "missing middle" existed — in fact Haunter's route tests already used
`createTestApp`. What was genuinely missing was **hook** coverage, for
exactly the reason the author named: `onUnboundPorts` defaults to
`"ignore"`, so the rate-limit hook silently no-ops unless the port is bound
in the test app. [features/pages/tests/route-hooks.test.ts](../features/pages/tests/route-hooks.test.ts)
now binds `createMemoryRateLimiter()` and asserts the 429 past
`meta.rateLimit`, plus a same-key idempotent replay (same response, no
second row).

**Residuals:**

- The unbound-ports default makes hook coverage opt-in and easy to miss —
  a `doctor` hint or a louder harness warning would help.
- *(New, found during adoption)* the hooks' 429 carries
  `retryAfterSeconds` only in the error body's `details`; no `Retry-After`
  HTTP header is set. Client backoff generally looks at the header (our
  manual raw-route rate limit sets it). Header parity would be a small,
  worthwhile fix.

### Client-side machinery (withdrawn)

The original report claimed invalidation helpers were hand-rolled. Wrong:
`rq(contract).queryOptions/key/filter/invalidate` are contract-derived, and
Haunter's `features/*/client/queries.ts` files are one-line delegations to
them — the documented recommended pattern. The real ask is the
mutation→query linkage listed under still-open gap #4.

## Withdrawn small stuff

- **pino preset**: absent from `providers add` because it ships registered
  in every starter by default — Haunter's own
  [server/providers.ts](../server/providers.ts) came scaffolded with it.
- **Dev/prod database separation**: the starter's `.env.example` already
  defaults to `SQLITE_DB_URL=file:local.db` with exactly the warning
  comment the report proposed. Haunter's dev environment pointing at the
  production Turso instance happened despite the guardrail, not for lack of
  one.

## Overall shape

Unchanged, but sharpened by the corrections: the server-side core —
contracts → use cases → ports → providers — is the strong 80%, and several
of the "boundary gaps" turned out to be **discoverability** gaps rather
than missing APIs (`createServiceContext`, the testing harness, the rq
client machinery, the webhook route factories all existed and went
unfound). The residual boundary gaps that are real: hooks for raw routes,
context-latency visibility, and a realtime recipe. If there's one meta-ask,
it's surfacing what already exists — the framework is ahead of its
documentation.
