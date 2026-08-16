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
bun beignet check
```

One command runs the whole loop: `beignet lint` (dependency direction),
`beignet doctor --strict`, then the app's `lint` (Biome), `typecheck`, and
`test` scripts. Every step runs even if an earlier one fails. Use
`bun run format` to apply Biome formatting.

Before handing off a change, inspect its source-backed impact:

```bash
bun beignet map --changed --json
bun beignet map --changed --base origin/main --json
```

The first command covers staged, unstaged, and untracked work. The second also
includes branch commits since the merge base with the existing local
`origin/main` ref; it does not fetch.

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
`./node_modules/.bin/beignet mcp`. It exposes these structured tools:
`app_map`, `explain`, `check`, `db`, `db_status`, `db_schema_sync`, `task_run`,
`schedule_run`, `outbox_inspect`, `outbox_run`, `routes`, `doctor`,
`doctor_fix_plan`, `doctor_fix`, `lint`, `make`, and `provider_add`.

Use `app_map` with `{ "changed": true }` for the MCP equivalent of
`beignet map --changed --json`. Add `base` to include committed branch changes.
Plan guarded repairs with `doctor_fix_plan` before calling `doctor_fix`, and
finish edits with `check`. The server also publishes app guidance and focused
feature-map resources. Clients that do not read `.mcp.json` can use the same
command from the app root; use `bun beignet mcp` only for terminal debugging.
