# haunter — agent guide

This is a Beignet contract-first app. Full framework docs live at
https://beignetjs.com (agent-friendly index at https://beignetjs.com/llms.txt).
README.md covers setup and the app map; this file covers what is not
discoverable from the code.

## Registration is explicit

Hand-writing an artifact file does not wire it into the app. Non-registration
is a silent failure — the file exists but never runs:

- Feature route groups in `features/<feature>/routes.ts` must be composed in
  `server/routes.ts` via `defineRoutes([...])`.
- Schedules must be added to the `schedules` array in `server/schedules.ts`.
- Tasks must be added to `defineTasks([...])` in `server/tasks.ts`.
- Outbox events and jobs must be registered in `defineOutboxRegistry({...})`
  in `server/outbox.ts`.
- Listeners must be wired through a `registerListeners(...)` call in infra
  wiring.

The starter ships no workflow registries — generators create them on first
use, so their absence is fine. `bun beignet make event`, `bun beignet make job`,
`bun beignet make listener`, `bun beignet make schedule`, `bun beignet make task`,
`bun beignet make seed`, and `bun beignet make upload` create or update their
required app entrypoints.
`bun beignet doctor` detects registration drift. `bun beignet doctor --fix` repairs
route-group, schedule, task, and outbox registration; listener drift is
report-only and must be fixed by hand.

## Prefer generators

`bun beignet make <artifact> <name>` creates correctly placed, pre-registered
files — prefer it over hand-writing them. See `bun beignet make --help` for the
artifact list. Use `bun beignet make feature <name> --recipe full-slice` when you
need a richer reference slice with policy, client helpers, workflow artifacts,
events, listener registration, jobs, and outbox wiring. After changing the Drizzle schema in
`infra/db/schema/`, run `bun beignet db generate` then `bun beignet db migrate`.

## Validation loop

Run after every change:

```bash
bun run lint
bun beignet lint
bun beignet doctor --strict
bun run test
bun run typecheck
```

`bun run lint` runs Biome's code lint. Use `bun run format` to apply formatting.
`bun beignet lint` is Beignet's dependency-direction lint.

## Package skills

This app trusts Beignet's package-shipped agent skills through
`package.json#intent.skills`. Before substantial Beignet changes, run:

```bash
bunx @tanstack/intent@latest list
bunx @tanstack/intent@latest load @beignet/core#app-architecture
```

Load more specific skills when they match the task, for example `@beignet/next#routes-server`, `@beignet/react-query#client`, `@beignet/react-hook-form#forms`, `@beignet/provider-db-drizzle#database-provider`, `@beignet/provider-auth-better-auth#auth-provider`, or `@beignet/cli#app-structure`.
Run `bunx @tanstack/intent@latest install` if this repository does not yet have Intent's managed
skill-loading block.

## Placement rules

- Feature artifacts live under `features/<feature>/`, with tests in
  `features/<feature>/tests/` (not `__tests__/`).
- Feature-specific client data-fetching helpers, query options, mutation
  options, invalidation helpers, and hooks live in
  `features/<feature>/client/`; shared client setup stays in root `client/`.
- Domain and use-case code must not import infra, providers, or React.
- Routes must not import concrete infra.

## Naming grammar

- `defineX` declares things you register: contracts, routes, jobs,
  schedules, and the rest.
- `createX` builds runtime objects you call: servers, clients, providers,
  and the `createX<AppContext>()` factories that return app-bound
  `defineX` builders.

## MCP server

`.mcp.json` registers the app-local `@beignet/cli` bin at
`./node_modules/.bin/beignet mcp`, which exposes routes/doctor/lint/make as
structured tools named exactly: `routes`, `doctor`, `doctor_fix`,
`lint`, `make`. Clients that do not read `.mcp.json` can use the same
command from the app root; use `bun beignet mcp` only for terminal debugging.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
