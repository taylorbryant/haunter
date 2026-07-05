# Beignet feedback from building Haunter

Haunter was built partly to stress-test Beignet. By the end it exercised a
wide slice of the framework: 8+ feature slices, environment-swapped
providers, an auth provider wrapping a large third-party framework (Better
Auth with the organization and agent-auth plugins), non-HTTP entrypoints
(agent capabilities), custom API routes outside contracts (Liveblocks room
auth), a remote libSQL/Turso database, and one real production performance
investigation. This is the report: what held up, then the gaps ranked by
how much they hurt in practice.

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
  ~130ms, so it actually gets run.

## Gaps, ranked by pain

### 1. Context creation has no performance story

The biggest real-world finding. `defineServerContext`'s `request` hook
encourages sequential awaits — Haunter's does `getSession` then `findRole`
([server/context.ts](../server/context.ts)) — and every contract call pays
it. With a remote database that was a ~250ms floor on **every** request
before the use case ran, and the app "felt slow in production" until it was
found and mitigated at the app level (Better Auth `cookieCache`, manual
parallelization).

Nothing in the framework surfaces this:

- No per-stage timings in dev. A request waterfall (`context: 250ms,
  hooks: 30ms, use case: 40ms`) would have located the problem in minutes.
  `TraceContext` exists but never produced anything actionable.
- No memoization/batching primitive for context resolvers.
- No guidance doc on context latency budgets for serverless + remote-DB
  deployments (the default deployment story).

A dev-mode waterfall per request is probably the single highest-leverage
addition to the framework.

### 2. Escape-hatch routes drop the whole pipeline

Real apps always have routes that can't be contracts: Liveblocks room auth,
Better Auth's `/api/auth/*`, future webhooks. The moment one is written, it
loses rate limiting, error mapping, and logging, and hand-rolls
`server.createContextFromNext()` plus manual `ports.rateLimit.hit`.
[app/api/liveblocks-auth/route.ts](../app/api/liveblocks-auth/route.ts)
literally carries the comment "this route bypasses the contract hooks, so
enforce the limit manually."

Wanted: a blessed `wrapRawRoute(handler, { rateLimit, ... })` that reuses
the hooks pipeline without requiring a contract.

### 3. Ports are unreachable outside app context

The auth layer's mailer callbacks run before/outside the server, so
[lib/mail.ts](../lib/mail.ts) instantiates its own standalone Resend client
("this standalone instance lets the auth layer send without a bootstrap
cycle") and logs with `console.*` because the pino `LoggerPort` isn't
reachable there either. Frameworks-within-the-framework (Better Auth is
essentially one) need a sanctioned way to reach mailer/logger ports — or at
minimum a documented pattern.

### 4. Building synthetic contexts by hand requires internals knowledge

For agent capabilities, assembling
`ports.gate.attach({ requestId, actor, auth, tenant, membership, ports })`
by hand meant reading framework source to get the shape right. Non-HTTP
entrypoints (agents, cron, queues, backfills) are common enough to deserve
a first-class API: `server.createServiceContext({ asUser, tenantId })` or
similar impersonation builder.

### 5. The client layer is conventions, not machinery

`@beignet/react-query` generates query options, but every feature
hand-rolls invalidation helpers (`invalidatePages`, `invalidatePage`,
`setPageSavedAtInCache`, …). Contracts already know the resource graph;
contract-derived cache keys and invalidation helpers — e.g.
`rq.invalidate(getPage, { id })`, or declaring "this mutation touches these
queries" on the contract — would remove the most repetitive client code in
the app.

### 6. Two env systems, and opaque boot failures

`lib/env.ts` (zod) and `providerConfig` (DB credentials passed separately
at `createNextServer`) coexist awkwardly. When `BETTER_AUTH_SECRET` was
missing in a production build, the good error message ("[Beignet env]
Invalid environment") surfaced as a module-evaluation stack trace pointing
into a Turbopack chunk, rendered to the user as a bare 500. Unified env
schema + a clean startup error would be friendlier.

### 7. Provider preset coverage lags the packages

`provider add` offers nine presets, but:

- **pino isn't one**, even though the starter itself registers
  `loggerPinoProvider`.
- **Vercel Blob isn't one** — the adapter was hand-written
  ([infra/storage/vercel-blob-storage.ts](../infra/storage/vercel-blob-storage.ts)).
- **No realtime/collab port concept exists.** The entire Liveblocks
  integration (room auth, env-mode gating, Y.Doc lifecycle, room caching)
  was bespoke. That may be the right call, but even a docs recipe would
  have saved time.

Paper cut in the same area: the "provider ternaries must be inline in the
providers array literal" constraint is surprising and cost a debugging
session before it was understood.

### 8. Registration is still a human problem

`doctor --fix` repairs most drift, but listeners are report-only, and the
deeper question stands: the file-exists-but-never-runs failure class only
exists because registration is manual. Options worth considering:
convention-based discovery generated from file placement (with doctor as
the escape valve), or making unregistered artifacts a type error.

Related: the validation loop is five commands (`bun run lint`,
`bun beignet lint`, `bun beignet doctor --strict`, `bun run test`,
`bun run typecheck`). A single `beignet check` would get run more often
than the litany.

### 9. Testing has a missing middle

Use-case testers with in-memory repos are great. But there's nothing
between that and a manual browser pass: no route-level harness that
exercises the real hooks. Whether rate limiting actually 429s or
idempotency actually dedupes effectively shipped untested.

## Small stuff

- `PRAGMA foreign_keys = ON` had to be added manually to
  [infra/db/database-ready.ts](../infra/db/database-ready.ts); the starter
  could ship it.
- No starter guidance on separating dev and prod databases. Haunter's dev
  environment pointing at the production Turso instance was an app mistake,
  but a starter default of `SQLITE_DB_URL=file:local.db` in `.env.example`
  with a comment would prevent it.
- `bun beignet provider --help` errors while `providers` exists; the CLI
  could alias or suggest harder.

## Overall shape

The server-side core — contracts → use cases → ports → providers — is the
strong 80%. The gaps cluster at the **boundaries**: where requests enter
outside contracts (#2), where code runs outside request context (#3, #4),
where the client consumes contracts (#5), and where performance is
invisible (#1). None of them undermine the architecture; all of them are
places where an app under real use had to leave the paved road.
