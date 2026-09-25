<img src="app/icon.svg" alt="" width="48" height="48">

# Haunter

Haunter keeps notes, tasks, and canvases together. Write in nested pages, keep
tasks next to the thinking behind them, and sketch ideas without switching
tools.

Let an AI client help without opening up your entire account. You decide what
each client can do and which workspaces it can reach.

[Open Haunter](https://haunter.app) ·
[View the changelog](https://haunter.app/changelog)

![Haunter — a demo Home dashboard with today’s tasks, favorite pages, and recently viewed notes](docs/screenshot.png)

![Haunter — a populated page with rich text, task blocks, a callout, and syntax-highlighted SQL](docs/page-screenshot.png)

## What you can do

- **Start with what matters.** Home gives you one view of overdue tasks, tasks
  due today or in the next seven days, favorites, and recently viewed pages and
  canvases.
- **Build connected notes.** Use nested pages, search, and backlinks to keep
  ideas connected. Attach files, revisit page history, and publish read-only
  links.
- **Think visually.** Keep a canvas inside the page it belongs to or give it a
  place of its own. Start from a diagram or wireframe template, then arrange
  fully editable building blocks.
- **Keep tasks in context.** Tasks can live inside a page or on their own.
  Assign them to workspace members, write due dates in natural language, add
  due times, and manage them from the workspace task list.
- **Work together with clear boundaries.** Workspace roles separate viewing,
  editing, and member management. Edit pages and canvases together in real time.
- **Take your pages with you.** Move pages in or out as Markdown, or create
  standalone HTML in your chosen Haunter theme.
- **Connect AI on your terms.** Use Haunter's hosted MCP server or a local Agent
  Auth bridge with supported AI clients. Choose a permission profile and
  workspaces, review recent activity, and disconnect a client at any time.

## Run Haunter locally

To run Haunter locally, install Bun 1.4.x. The default setup stores data in a
local libSQL database and prints passwordless sign-in codes in the terminal,
so you can sign in without configuring an email provider.

### 1. Clone and install Haunter

```bash
git clone https://github.com/taylorbryant/haunter.git
cd haunter
bun install
cp .env.example .env.local
```

### 2. Choose the first administrator

Add `BOOTSTRAP_ADMIN_EMAIL` to `.env.local` with the email address for the first
app administrator:

```env
BOOTSTRAP_ADMIN_EMAIL=owner@example.com
```

On a fresh installation, the first verified account matching that address
becomes the app-wide administrator. The setting is ignored after an
administrator has been approved.

### 3. Create the database and sign in

```bash
bun beignet db migrate
bun run dev
```

In a second terminal, from the same directory, start the collaboration worker:

```bash
bun run dev:collaboration
```

Keep both processes running. The defaults in `.env.local` connect the app to the
worker at `ws://localhost:1234`, using the same local database.

Open [http://localhost:3000/sign-in](http://localhost:3000/sign-in), request a
code for the configured email address, and copy the six-digit code from the
server console. The first sign-in continues through workspace onboarding.

If the account was created before `BOOTSTRAP_ADMIN_EMAIL` was configured, leave
it on the waitlist and run:

```bash
bun run bootstrap-admin --email owner@example.com
```

Sign out and back in after the command completes so the new administrator role
is reflected in the browser session.

## Development

### Validate changes

The tests require `redis-server` on your PATH (`brew install redis` on macOS,
`sudo apt-get install redis-server` on Ubuntu), or an explicit
`REDIS_SERVER_BINARY` path. Redis tests start a temporary instance with a private
Unix socket and persistence disabled; they never use your configured Redis service.

Run the full validation loop after making changes:

```bash
bun beignet check
```

The command runs Beignet's dependency-direction lint and strict doctor checks,
then the app's Biome lint, type check, and tests. Every check runs even when an
earlier check fails. Use `bun run format` to apply Biome formatting.

See [Editor benchmarks](docs/editor-benchmarks.md) for document benchmarks and
browser checks covering page readiness, typing, and synchronization.

### Generate a feature

Prefer Beignet's generators so new artifacts are placed and registered
correctly:

```bash
bun beignet make feature projects --recipe full-slice
bun beignet db generate
bun beignet db migrate
```

Use `bun beignet make --help` to see the available artifact generators. After
changing the Drizzle schema in `infra/db/schema/`, generate a migration and
apply it to your local development database. Deployments apply checked-in
migrations separately.

### Work with coding agents

The repository exposes Beignet's package skills through
`package.json#intent.skills`. Install Intent's managed skill block, then load
the skill that matches the change:

```bash
bunx @tanstack/intent@latest install
bunx @tanstack/intent@latest list
bunx @tanstack/intent@latest load @beignet/core#app-architecture
```

`AGENTS.md` and `CLAUDE.md` describe the app's placement, registration, naming,
and validation conventions.

### Project structure

- `app/` contains the Next.js routes and application layouts.
- `features/` contains product slices, including their contracts, use cases,
  client helpers, components, and tests.
- `ports/` defines app-owned dependencies; `infra/` provides their concrete
  database and service implementations.
- `server/` composes routes, providers, schedules, tasks, and outbox handlers.
- `components/` and `client/` contain shared UI and client infrastructure.
- `infra/db/schema/` contains the Drizzle schema, and `drizzle/` contains the
  checked-in migrations.

Routes, schedules, tasks, outbox handlers, and listeners require explicit
registration. Run `bun beignet doctor --strict` before opening a pull request
to catch registration drift.

## Deploy Haunter

Use [`.env.example`](.env.example) as the complete configuration reference.
Configure the production environment before building and starting the app:

- Set `APP_URL` to the canonical public origin and set `BETTER_AUTH_SECRET` to
  a unique secret of at least 32 characters.
- Point `SQLITE_DB_URL` and, when required, `SQLITE_DB_AUTH_TOKEN` at a
  persistent libSQL database such as Turso.
- Set `RESEND_API_KEY` and `RESEND_FROM` to a verified sender for passwordless
  sign-in and workspace invitations.
- Set `NEXT_PUBLIC_COLLABORATION_URL` to the worker's public `wss://` URL before
  building. The worker needs the same database, auth secret, and canonical
  `APP_URL` as Next.
- Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` before building for a production domain.
- Remove `DEVTOOLS_ENABLED=true` unless the production devtools route is
  protected appropriately.
- Confirm that the default workspace roles match the deployment's needs:
  `viewer` is read-only; `member`, `admin`, and `owner` can edit workspace
  content; and `admin` and `owner` can manage members and invitations. See
  [Workspace membership authorization](docs/membership-authorization.md) for
  the authorization boundaries.

On a fresh installation, also set `BOOTSTRAP_ADMIN_EMAIL` before the owner
first signs in. Leave it unset on established installations.

Apply the checked-in migrations before starting each production release:

```bash
bun beignet db migrate
bun run build
bun run start
```

### Collaborative editors

Page bodies use Yjs/Hocuspocus, and canvases use first-party tldraw sync. Both
protocols run in one persistent WebSocket worker alongside Next. Only one worker
may own a database at a time; deployments must stop it before starting its
replacement.

See [Collaboration](docs/collaboration.md) for worker deployment, preview origins,
storage, offline recovery, and troubleshooting.

### Optional services

- **Uploads:** Set `BLOB_READ_WRITE_TOKEN` to use Vercel Blob. Local filesystem
  storage does not survive serverless deployments.
- **Distributed rate limiting:** Set `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`. Without them, each app process keeps its own
  rate-limit state in memory.
- **Scheduled jobs:** Set `CRON_SECRET` before enabling the Vercel Cron Jobs or
  equivalent external scheduler described below.
- **Workspace live updates:** Set the Upstash REST variables above and
  `REDIS_BROADCAST_URL` to the Redis TCP/TLS connection URL (`rediss://…`), then
  build with `NEXT_PUBLIC_LIVE_UPDATES=true`. Workspace lists and metadata
  refresh after changes from other clients; pending edits delay those refreshes.
  Configure the same Redis URL and prefixes in Next and the collaboration
  worker so changes made through either process reach connected browsers.
  Use distinct `REDIS_BROADCAST_PREFIX` and `UPSTASH_WORKSPACE_EVENT_PREFIX`
  values for unrelated environments sharing a Redis database. The former
  isolates messages; the latter isolates per-user stream leases.
  Active streams are capped at eight per signed-in user by default; adjust
  `UPSTASH_WORKSPACE_EVENT_MAX_CONNECTIONS_PER_USER` if needed. Streams renew
  every four minutes and recheck workspace membership. A reconnect refreshes
  cached data to recover changes missed while disconnected. SQLite is the
  source of truth, and polling provides a fallback for workspace updates.
  Page and canvas editing use the collaboration worker's WebSocket connections.
  Changing `NEXT_PUBLIC_` values requires a new build.

### Authentication origins

Keep `APP_URL` on the canonical origin. `BETTER_AUTH_URL` is only needed when
Better Auth has a different public origin.

Vercel deployment, branch, and production hosts are admitted automatically
when Vercel system environment variables are exposed. Use
`BETTER_AUTH_ALLOWED_HOSTS` for additional aliases or other hosting providers.
Use `BETTER_AUTH_TRUSTED_ORIGINS` only for separate browser origins that call
the auth server.

### Hosted MCP

The hosted MCP endpoint defaults to `${APP_URL}/mcp`. Set `MCP_RESOURCE_URL`
when clients should use a different stable public endpoint. The value is also
the OAuth token audience, so it must match exactly and must not redirect.

Browser-based MCP clients with a separate origin must be listed in
`MCP_ALLOWED_ORIGINS`. Native and server-side clients generally omit the
`Origin` header. Apply the checked-in OAuth/MCP migrations before enabling the
endpoint.

For reading structured page content, editing blocks, and replacing page bodies,
see the [MCP page editing API](docs/mcp-page-editing.md).
For native canvas creation, shape edits, connections, image previews, and history, see the
[MCP canvas editing API](docs/mcp-canvas-editing.md).
For discovering your open tabs, current page, and canvas selection, see
[live session context](docs/mcp-live-context.md).

### Task reminders and push notifications

Vercel registers the production schedules in `vercel.json`:

- `/api/cron/tasks/check-overdue` checks for due reminders and overdue tasks
  every five minutes.
- `/api/cron/agents/cleanup-oauth-clients` removes up to 500 unused dynamic
  OAuth client registrations older than 24 hours daily at 03:00 UTC.

The five-minute reminder schedule requires Vercel Pro or Enterprise. Vercel
Hobby projects can run a cron job only once per day, so use another scheduler
if reminders need to remain timely on that plan.

Set `CRON_SECRET` to a random value of at least 16 characters in the Vercel
project. Vercel automatically sends it to each route as an
`Authorization: Bearer <CRON_SECRET>` header. Both routes fail closed when the
secret is missing or does not match.

On another hosting provider, configure equivalent authenticated `GET` requests
using the schedules above.

In-app notifications work without Web Push. To deliver notifications while
Haunter is closed, generate VAPID keys:

```bash
bunx web-push generate-vapid-keys
```

```env
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:notifications@example.com
```

Users enable push separately for each device in Settings.
