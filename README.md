<img src="app/icon.svg" alt="" width="48" height="48">

# Haunter

Haunter brings notes and tasks into one workspace, then lets approved AI
clients work with them using only the permissions and workspaces you choose.
Organize ideas in nested pages, keep tasks close to their source, and return to
what matters from a focused Home dashboard.

[Open Haunter](https://haunter.app) ·
[View the changelog](https://haunter.app/changelog)

![Haunter — a demo Home dashboard with today’s tasks, favorite pages, and recently viewed notes](docs/screenshot.png)

![Haunter — a populated page with rich text, task blocks, a callout, and syntax-highlighted SQL](docs/page-screenshot.png)

## Highlights

- **Home** brings together overdue and due-today tasks, the next seven days,
  favorite pages, and recently viewed notes.
- **Pages** support nested navigation, search, backlinks, history, attachments,
  public sharing, and a block editor with rich text, callouts, task blocks,
  code, and embedded tldraw canvases.
- **Tasks** can live inside a page or stand alone. Assign them to workspace
  members, use natural-language due dates, add due times, and manage them from
  the workspace task list.
- **Collaboration** includes workspace roles, task assignment, real-time
  editing, and read-only public page links.
- **Import and export** move pages in and out as Markdown or create standalone
  HTML files that preserve the selected Haunter theme.
- **Themes and installation** provide coordinated light and dark app and code
  themes. Install Haunter on a phone or computer for an app-like experience.
- **AI clients** connect through Haunter's hosted OAuth-authenticated MCP
  server or a local Agent Auth bridge. Users choose a permission profile and
  workspaces, review activity, and can disconnect a client at any time.

## Run Haunter locally

Haunter uses [Bun](https://bun.sh) for dependency management, scripts, and
tests. The default development configuration uses a local libSQL database and
prints passwordless sign-in codes to the server console.

### 1. Install the project

```bash
git clone https://github.com/taylorbryant/haunter.git
cd haunter
bun install
cp .env.example .env.local
```

### 2. Configure the first administrator

Set `BOOTSTRAP_ADMIN_EMAIL` in `.env.local` to the email address that should own
the installation:

```env
BOOTSTRAP_ADMIN_EMAIL=owner@example.com
```

On a fresh installation, the first verified account matching that address
becomes the app-wide administrator. The setting is ignored after an
administrator has been approved.

### 3. Prepare the database and start Haunter

```bash
bun beignet db migrate
bun run dev
```

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

Run the full validation loop after making changes:

```bash
bun run lint
bun beignet lint
bun beignet doctor --strict
bun run test
bun run typecheck
```

Biome handles code linting and formatting (`bun run format`). Beignet's lint
checks dependency direction, while `doctor --strict` detects registration,
OpenAPI, and resource drift.

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

Apply the checked-in migrations before starting a production release:

```bash
bun beignet db migrate
bun run build
bun run start
```

### Required configuration

- Set `APP_URL` to the canonical public origin and generate a strong
  `BETTER_AUTH_SECRET`.
- Point `SQLITE_DB_URL` and, when required, `SQLITE_DB_AUTH_TOKEN` at a
  persistent libSQL database such as Turso.
- Set `LIVEBLOCKS_SECRET_KEY`, configure a Liveblocks `ydocUpdated` webhook at
  `/api/webhooks/liveblocks`, and set `LIVEBLOCKS_WEBHOOK_SECRET`.
- Set `RESEND_API_KEY` and `RESEND_FROM` to a verified sender for passwordless
  sign-in and workspace invitations.
- Remove `DEVTOOLS_ENABLED=true` unless the production devtools route is
  protected appropriately.
- Review the authorization and workspace-role policies before exposing
  user-owned data.

On a fresh installation, also set `BOOTSTRAP_ADMIN_EMAIL` before the owner
first signs in. Leave it unset on established installations.

### Optional services

- **Uploads:** Set `BLOB_READ_WRITE_TOKEN` to use Vercel Blob. Local filesystem
  storage does not survive serverless deployments.
- **Distributed rate limiting:** Set `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`. Without them, Haunter uses an in-process limiter
  intended for development.
- **Canvases:** Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` before using tldraw on a
  production domain.
- **Scheduled notifications:** Set `CRON_SECRET` before enabling the
  notification workflow described below.

#### Collaborative documents

Liveblocks-hosted Yjs documents are authoritative for page titles, BlockNote
blocks, and tldraw records. SQLite remains the query, search, share, task, and
recovery projection. If Liveblocks cannot be reached, read paths serve the last
successfully materialized SQLite projection read-only; editing fails closed
rather than overwriting newer shared data.

Existing SQLite documents are backwards-compatible with this model. Before
the first deployment that enables it:

1. Apply the checked-in database migrations and configure the Liveblocks
   secret and webhook.
2. Pause page and canvas edits.
3. Dry-run each workspace with
   `bun beignet task run documents.backfill --tenant <workspace-id>`.
4. Seed each workspace with the same command plus
   `--input '{"dryRun":false,"replaceExisting":"replace-liveblocks-from-sqlite"}'`.
5. Deploy the new application, verify a representative page and canvas, then
   resume edits.

Pages or canvases missed by the backfill are seeded lazily from SQLite on first
access. The explicit `replaceExisting` confirmation is only for this paused
cutover; running it later would overwrite newer collaborative content.

The document-store port is intentionally provider-neutral so a Hocuspocus
adapter can replace Liveblocks without changing page, canvas, or MCP use cases.
Workspace page-tree metadata remains authoritative in SQLite. A separate,
storage-free `workspace:<id>` Liveblocks room broadcasts post-commit
invalidation hints so collaborators see creates, renames, moves, icon changes,
and trash/restore actions immediately. Reconnects and the existing polling
refresh repair any ephemeral events missed while a client was offline.

For an emergency rollback, first stop document edits and drain the outbox so
the latest Yjs state reaches SQLite, then roll back the deployment. The
additive document registry tables and Liveblocks rooms can remain in place;
the previous release continues reading the SQLite projection.

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

### Notifications

The workflow in `.github/workflows/overdue-notifications.yml` calls the
protected overdue-task schedule. Configure:

- Repository secret `CRON_SECRET` with the same value used by the deployed app.
- Repository variable `APP_URL` with the canonical deployed origin. Redirects
  are treated as failures so authorization is never forwarded to another host.

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
