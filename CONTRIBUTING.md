# Contributing to Haunter

Use this guide to develop and validate changes to Haunter locally.

## Local development

Install Bun 1.4.2, the version declared in `package.json`. The default setup stores
data in a local libSQL database and prints passwordless sign-in codes in the
terminal, so you can sign in without configuring an email provider.

### 1. Clone and install dependencies

```bash
git clone https://github.com/taylorbryant/haunter.git
cd haunter
bun install
cp .env.example .env.local
```

### 2. Choose your local administrator

Add `BOOTSTRAP_ADMIN_EMAIL` to `.env.local` with the email address you will use
for local development:

```env
BOOTSTRAP_ADMIN_EMAIL=owner@example.com
```

In a fresh local database, the first verified account matching that address
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

## Validate changes

The tests require `redis-server` on your PATH (`brew install redis` on macOS,
`sudo apt-get install redis-server` on Ubuntu), or an explicit
`REDIS_SERVER_BINARY` path. Redis tests start a temporary instance with a private
Unix socket and persistence disabled; they never use your configured Redis service.

Canvas preview tests also require Playwright's Chromium headless shell. Install
it after dependencies, and repeat after upgrading Playwright:

```bash
bunx --bun playwright install chromium --only-shell
```

On Linux, add `--with-deps` for browser system dependencies. If Chromium cannot
start its sandbox, see the [canvas renderer guidance](docs/collaboration.md#canvas-rendering-on-the-same-worker).

Run the full validation loop after making changes:

```bash
bun beignet check
```

The command runs Beignet's dependency-direction lint and strict doctor checks,
then the app's Biome lint, type check, and tests. Every check runs even when an
earlier check fails. Use `bun run format` to apply Biome formatting.

CI runs the same command, alongside production canvas-renderer and packaged-Yjs
verification.

Before opening a pull request, inspect the affected features and registrations:

```bash
bun beignet map --changed --json
bun beignet map --changed --base origin/main --json
```

The first command covers staged, unstaged, and untracked work. The second also
includes branch commits since the merge base with the existing local
`origin/main` ref; it does not fetch.

See [Editor benchmarks](docs/editor-benchmarks.md) for document benchmarks and
browser checks covering page readiness, typing, and synchronization.

## Project structure

- `app/` contains Next.js routes and layouts.
- `features/` groups contracts, use cases, UI, and tests by product feature.
- `ports/` defines app dependencies; `infra/` implements them.
- `server/` composes routes, providers, and background work.
- `components/` and `client/` contain shared browser code.
- `infra/db/schema/` defines the database; `drizzle/` contains migrations.
- `docs/` contains maintainer references for architecture, operations, and verification.
- `content/guides/` contains user guides published at `/guides`.
- `content/changelog/` contains release notes published at `/changelog`.

See [AGENTS.md](AGENTS.md) for generators, registration requirements, and coding
conventions.

## Propose a change

Use the repository's [issues](https://github.com/taylorbryant/haunter/issues) to
report a bug or suggest an improvement. For bugs, include steps to reproduce,
what you expected, what happened, and the browser or device involved. For
feature proposals, explain the task you want to accomplish.

In a pull request, describe the problem, the resulting behavior, and how you
verified the change. Include screenshots for visible UI changes and update
any affected guides. Note any checks you could not run.

See the [maintainer documentation](docs/README.md) for technical references and
instructions for updating the published user guides.
