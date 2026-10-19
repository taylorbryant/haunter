# Production operations

Before building and starting the hosted Haunter app or a preview deployment,
configure its environment using [`.env.example`](../.env.example). For local setup,
see [Local development](../CONTRIBUTING.md#local-development).

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
  [Workspace membership authorization](membership-authorization.md) for
  the authorization boundaries.

For a new preview database, set `BOOTSTRAP_ADMIN_EMAIL` before its administrator
first signs in. Leave it unset in the established production environment. Keep
preview databases, credentials, and workers separate from production.

Apply the checked-in migrations before starting each production release. When a
release changes worker commands, deploy the collaboration worker before the web
app. Follow the [worker deployment procedure](collaboration.md#worker-deployment)
to flush saves and keep exactly one worker per database.

```bash
bun beignet db migrate
```

Confirm the database target printed by the migration command.

After migrations and the worker rollout, build and start the web app:

```bash
bun run build
bun run start
```

## Optional services

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

## Authentication origins

Keep `APP_URL` on the canonical origin. `BETTER_AUTH_URL` is only needed when
Better Auth has a different public origin.

Vercel deployment, branch, and production hosts are admitted automatically
when Vercel system environment variables are exposed. Use
`BETTER_AUTH_ALLOWED_HOSTS` for additional aliases or other hosting providers.
Use `BETTER_AUTH_TRUSTED_ORIGINS` only for separate browser origins that call
the auth server.

## Hosted MCP

The hosted MCP endpoint defaults to `${APP_URL}/mcp`. Set `MCP_RESOURCE_URL`
when clients should use a different stable public endpoint. The value is also
the OAuth token audience, so it must match exactly and must not redirect.

Browser-based MCP clients must match an exact app/auth origin or an additional
origin in `MCP_ALLOWED_ORIGINS`. Wildcard auth origins do not authorize MCP
requests. Native and server-side clients generally omit the `Origin` header.

For embedded editor authentication, framing, and host configuration, see
[MCP App integration](mcp-app.md).

## Task reminders and push notifications

Vercel registers the production schedules in [`vercel.json`](../vercel.json):

- `/api/cron/tasks/check-overdue` checks for due reminders and overdue tasks
  every five minutes.
- `/api/cron/agents/cleanup-oauth-clients` removes up to 500 unused dynamic
  OAuth client registrations older than 24 hours daily at 03:00 UTC.

Use a hosting plan or external scheduler that supports the five-minute reminder
schedule. Less frequent invocation delays reminders.

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
