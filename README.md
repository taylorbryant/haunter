<img src="app/icon.svg" alt="" width="48" height="48">

# Haunter

Haunter keeps notes, tasks, and canvases together, with real-time collaboration
and an MCP API for connected agents.

This README and `docs/` are for maintainers and contributors developing,
deploying, and debugging Haunter. For instructions on using the app or connecting
an agent, read the public guides.

[Open Haunter](https://www.haunter.app) ·
[Read the guides](https://www.haunter.app/guides) ·
[View the changelog](https://www.haunter.app/changelog)

![Haunter — a demo Home dashboard with today’s tasks, favorite pages, and recently viewed notes](docs/screenshot.png)

![Haunter — a populated page with rich text, task blocks, a callout, and syntax-highlighted SQL](docs/page-screenshot.png)

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

### Project structure

- `app/` contains Next.js routes and layouts.
- `features/` groups contracts, use cases, UI, and tests by product feature.
- `ports/` defines app dependencies; `infra/` implements them.
- `server/` composes routes, providers, and background work.
- `components/` and `client/` contain shared browser code.
- `infra/db/schema/` defines the database; `drizzle/` contains migrations.

See [AGENTS.md](AGENTS.md) for generators, registration requirements, and coding
conventions.

## Maintainer documentation

The references below describe operational requirements, implementation
boundaries, and verification workflows. MCP references document the contracts
and client behavior to preserve when changing the tools.

| Topic | Reference |
| --- | --- |
| Deploying the app | [Deployment and configuration](docs/deployment.md) |
| Collaborative editing | [Worker operation, persistence, and recovery](docs/collaboration.md) |
| Workspace access | [Membership authorization](docs/membership-authorization.md) |
| MCP tools | [Pages](docs/mcp-page-editing.md), [canvases](docs/mcp-canvas-editing.md), [files](docs/mcp-files.md), [content management](docs/mcp-content-management.md), [search](docs/workspace-search.md) |
| Agent context and feedback | [Live context](docs/mcp-live-context.md), [canvas activity](docs/mcp-canvas-activity.md) |
| Embedded editor | [MCP App integration](docs/mcp-app.md) |
| UI maintenance | [Keyboard focus](docs/keyboard-focus.md), [editor benchmarks](docs/editor-benchmarks.md) |
| Dependency patches | [Editor patches and upgrade checks](patches/README.md) |
| Writing product documentation | [Guide authoring](content/help/README.md), [changelog authoring](content/changelog/README.md) |
