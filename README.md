# haunter

A personal notes app — Notion-style nested pages and block editor, Todoist-style
tasks that roll up into a per-workspace "My Tasks" view, syntax-highlighted
code/SQL blocks, and embedded tldraw canvases. Built on [Beignet](https://beignetjs.com)
(contract-first, scaffolded with `@beignet/cli`).

![Haunter — a weekly page with tasks, an inline page mention, and a syntax-highlighted SQL block](docs/screenshot.png)

## Features

- **Workspaces** separate work and personal notes; each has its own page tree
  and task list.
- **Pages** nest arbitrarily and are edited with a BlockNote editor
  (headings, lists, code blocks with shiki highlighting, tasks, canvases) that
  autosaves with a debounce.
- **Tasks** exist two ways: task blocks inside pages (reconciled into task rows
  on every content save, keyed by the block's own id) and standalone quick-add
  tasks. Toggling a task in My Tasks writes through to the source page
  document; toggling in the editor syncs on autosave.
- **Canvases** are tldraw documents embedded as blocks; snapshots persist
  per-canvas with a debounce, and the tldraw chunk loads only when a canvas
  block renders.

## Getting started

```bash
bun install
cp .env.example .env.local
```

## Prepare the database

```bash
bun beignet db migrate
```

The starter ships its initial Drizzle migration in `drizzle/`, so the first run only applies it. After you change `infra/db/schema/`, run `bun beignet db generate` and `bun beignet db migrate` together.

## Start the app

```bash
bun run dev
```

Open http://localhost:3000/sign-up, create the first account, then create a workspace from the sidebar switcher and add your first page.

## First checks

```bash
# in another terminal
bun beignet routes
bun run lint
bun beignet lint
bun beignet doctor
bun run test
bun run typecheck
```

`routes` shows the contracts Beignet can inspect. `bun beignet lint` checks dependency direction. `doctor` catches route, OpenAPI, and resource drift.
`bun run lint` runs Biome over the starter; use `bun run format` to apply formatting.

## Coding agents

This app trusts Beignet package skills through `package.json#intent.skills`.
Run `bunx @tanstack/intent@latest install` to add Intent's managed skill-loading block
to your agent config, then load matching package skills before substantial
Beignet changes. The generated `AGENTS.md` and `CLAUDE.md` stay short and
point agents at app-local conventions, generators, validation, and MCP tools.

## Build for production

```bash
bun run build
bun run start
```

## Generate a feature

```bash
bun beignet make feature projects
bun beignet db generate
bun beignet db migrate
bun run test
bun run lint
bun run typecheck
bun beignet lint
bun beignet doctor
```

`make feature` creates a contract-to-test vertical slice with Drizzle schema and repository files, so regenerate and migrate the database before running the app against the new feature.
Use `bun beignet make feature projects --recipe full-slice` when you want a richer reference slice with policy, feature client helpers, workflow artifacts, events, listener registration, jobs, and outbox wiring.

## App map

- `features/workspaces/`, `features/pages/`, `features/tasks/`, and
  `features/canvases/` are the four vertical slices. Each owns its
  `contracts.ts`, `schemas.ts`, `ports.ts`, `policy.ts`, `use-cases/`,
  `routes.ts`, `client/`, `components/`, and `tests/`.
- `features/pages/components/editor/schema.ts` is the single extension point
  for the block model (code block config, task block, canvas block). Future
  executable cells plug in here as a new block spec.
- `features/tasks/lib/` holds the pure document-walking helpers
  (`extract-task-blocks`, `patch-task-block`, `reconcile-page-tasks`) that keep
  task rows and page documents in sync. The reconciliation runs inside the
  `pages.saveContent` transaction.
- `features/shared/errors.ts` keeps application errors together;
  `features/shared/authorization.ts` owns the shared owner-check policy helper.
- `ports/` defines app-owned dependencies (repositories, gate, auth).
- `infra/` implements ports: one Drizzle repository per feature under
  `infra/<feature>/`, wired in `infra/db/repositories.ts`.
- `infra/db/schema/` contains the Drizzle schema, `drizzle/` contains the checked-in migrations.
- `server/routes.ts` keeps the central route registry and OpenAPI contract list.
- `server/context.ts` declares the context blueprint shared by the server and route tests.
- `server/providers.ts` wires devtools, Better Auth, pino, Drizzle/libSQL, and the starter database provider.
- `lib/env.ts` validates deployment configuration at startup.
- `lib/auth.ts` exposes `requireUser(ctx)` for protected use cases.
- `lib/better-auth.ts` owns Better Auth setup and keeps provider-specific auth details outside use cases.
- `app/(auth)/` and `app/(app)/` own the sign-in/sign-up pages and the authenticated shell.
- `components/` owns the app shell and shadcn/ui primitives.
- `client/` owns the typed API client, React Query helpers, and the Better Auth client.
- `features/<feature>/client/` may own feature-specific data-fetching helpers and hooks.

## Before deploying

- Keep `SQLITE_DB_URL=file:local.db` for local libSQL development or point it at a hosted libSQL database such as Turso.
- Run `bun beignet db generate` and `bun beignet db migrate` after changing the Drizzle schema.
- Run `bun beignet db reset` to rebuild a local SQLite database from the checked-in migrations.
- Remove `DEVTOOLS_ENABLED=true` in production unless you add authentication and stricter redaction.
- Set `APP_URL`, `BETTER_AUTH_SECRET`, `LOG_LEVEL`, and service-specific integration variables in your hosting environment.
- Set `BETTER_AUTH_TRUSTED_ORIGINS` before serving auth across multiple origins.
- Review the starter authorization policy before exposing user-owned data.
