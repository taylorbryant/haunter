# Collaboration

Haunter's page editor uses BlockNote, with Yjs and Hocuspocus for collaborative
editing. Canvases use tldraw and its sync protocol. Next.js serves the app and
HTTP API; one persistent Bun worker hosts both WebSocket protocols.

For local setup, follow the [README](../README.md#run-haunter-locally). Run
`bun run dev` and `bun run dev:collaboration` in separate terminals with the same
environment. Redis is not required for collaborative editing.

## Storage and updates

| Content | Authoritative storage | Readable projection |
| --- | --- | --- |
| Page body | Yjs binary state in `collaborative_documents.state` | `pages.content` for search, sharing, exports, task extraction, backlinks, and history |
| Canvas drawing | Native tldraw room snapshot in `canvas_sync_rooms.snapshot`, including clocks, schema, and tombstones | Document-only `canvases.snapshot` for sharing and exports |
| Titles, hierarchy, membership, and other metadata | SQL rows, updated through the HTTP API | React Query caches on the client |

Page creation seeds the Yjs document and its SQL projection in one transaction.
Editor changes travel as incremental Yjs updates. Each database save stores a
full binary snapshot and updates the SQL projections together. Task actions,
page appends, and history restores also write through the document repository
so the binary state and projections stay consistent.

The canvas SDK handles record synchronization, conflict resolution, presence,
and undo. The worker commits the native room and its readable projection in one
transaction before releasing protocol acknowledgements. Page save receipts
likewise confirm a durable database commit. Seeing a change in another tab does
not by itself prove that it has been saved to the database.

Optional workspace live updates use a separate event stream to refresh lists
and metadata. They do not carry page bodies or canvas edits.

## Worker deployment

The deployment entrypoint is [Dockerfile.collaboration](../Dockerfile.collaboration).
It runs `server/workers/collaboration.ts` with Bun, listens on port 1234, and
checks `/health`. Use a host that supports persistent WebSocket connections,
TLS termination, automatic process restart, and graceful shutdown.

Configure these values before starting the worker:

| Setting | Requirement |
| --- | --- |
| `APP_URL` | Same canonical website origin as Next, such as `https://app.example.com` |
| `SQLITE_DB_URL`, `SQLITE_DB_AUTH_TOKEN` | Same persistent database and credentials as Next |
| `BETTER_AUTH_SECRET` | Same signing secret as Next |
| `RESEND_API_KEY`, `RESEND_FROM` | Required by the shared app providers, including when booting the worker |
| `NEXT_PUBLIC_COLLABORATION_URL` | Public worker URL, such as `wss://collab.example.com`; set at worker runtime and before building Next |
| `COLLABORATION_HOST`, `COLLABORATION_PORT` | Container defaults are `0.0.0.0` and `1234`; local defaults are `127.0.0.1` and `1234` |

Match the app's optional Blob, Upstash, and Web Push configuration when those
providers are enabled. Supply secrets at runtime, not in the container image.
See [`.env.example`](../.env.example) for the full configuration reference.

### One worker per database

The worker acquires a database lease, renews it every five seconds, and loses
ownership after 30 seconds without renewal. A second worker cannot acquire the
same lease, and expired owners cannot commit writes. This protects persistence;
it does not provide routing across multiple workers.

Keep exactly one worker instance per database. Stop the old instance before
starting its replacement, allow saves to flush, and expect clients to reconnect
during deployment. Do not run a local worker against a database already served
by another worker. Allow at least 30 seconds for graceful shutdown; the checked-in
Fly configuration allows 60 seconds. After a crash, let the lease expire rather
than deleting ownership rows manually.

[fly.collaboration.toml](../fly.collaboration.toml) targets Haunter's production
app, `haunter-collaboration`, in `iad`. It configures one shared CPU, 1 GB RAM,
continuous operation, health checks, and replacement of the existing Machine.
For another environment, use a separate config with its own app name, worker
URL, database, and secrets before deploying.

For the checked-in production configuration:

```sh
fly deploy --config fly.collaboration.toml --ha=false
fly machine list --app haunter-collaboration
fly checks list --app haunter-collaboration
curl --fail https://collab.haunter.app/health
```

Keep `--ha=false` and verify that exactly one Machine exists. Do not add replicas
or switch this configuration to canary or bluegreen deployment. Apply database
schema migrations separately as described in the [README](../README.md#deploy-haunter).

### Preview origins and authentication

The worker accepts browser connections from `APP_URL`. Add trusted preview
origins to the worker's `COLLABORATION_ALLOWED_ORIGINS` as a comma-separated list
of exact HTTP(S) origins, without paths or wildcards. A stable preview alias
avoids editing the list for each deployment URL.

Each preview must use the same database and auth secret as its worker. Keep
preview databases and workers separate from production. Changing the browser's
`NEXT_PUBLIC_COLLABORATION_URL` requires rebuilding Next; changing the worker's
origin allowlist requires restarting the worker.

Origin checks are separate from authentication. Next issues short-lived tokens
bound to the signed-in session, user, workspace, and resource. The worker also
checks live access and grants viewers read-only sessions. Adding an origin does
not grant access to a workspace. See [authentication origins](../README.md#authentication-origins)
for the separate settings governing sign-in.

## Offline edits and recovery

| Situation | Page | Canvas |
| --- | --- | --- |
| Connection drops while editing | Yjs updates are retained in IndexedDB and merge after reconnection | The open tab retains edits in tldraw's pending queue and resends them after reconnection |
| Reload before synchronization | Cached body and pending Yjs updates can reload from IndexedDB | The SDK's pending queue does not survive reload; recover the separate local copy into a new canvas or download it |
| Open while the worker is unreachable | Requires a cached body; the app shell and metadata require Next | Initial canvas loading requires a server connection; saved recovery copies remain downloadable |

Keep a disconnected canvas tab open while it reconnects. Canvas recovery copies
are stored separately per account, workspace, canvas, and mounted instance. They
are never automatically loaded over the shared drawing. Use the recovery notice
to create a separate canvas or download a copy.

For pages, save errors offer retry and download actions. **Pages → Recover drafts**
imports downloaded recovery files into new pages. Restoring page history advances
the document generation so old offline edits cannot overwrite the restored body.
The prior local generation remains available as a recovery download, including
its unsent edits; restoring also resets the editor's undo history.

Browser copies are not account backups. Avoid clearing site data while unsynced
work or recovery copies remain. If browser storage fails, keep the tab open and
download the available copy before navigating away.

## Troubleshooting

- **Worker is unavailable:** Check `/health` and worker logs. A healthy response
  requires an active lease, working lease renewal, and no failed document saves.
  Investigate database connectivity, storage errors, and competing workers before
  restarting repeatedly. A failed save is not acknowledged as durable.
- **Worker reports `Run documents.migrate before starting collaboration`:** Its
  read-only startup check found missing collaborative state or mismatched
  projections. Confirm the target database and inspect the read-only report with
  `bun beignet task run documents.migrate --json`. Any repair requires a backup
  and paused writers; normal worker startup does not convert data automatically.
- **Page or canvas cannot connect:** Check the worker URL embedded in the app
  build, TLS, browser origin allowlist, and matching database/auth secret. Check
  access to the resource and complete the in-app sign-in recovery flow if the
  session expired.
- **Canvas briefly reconnects:** Short-lived token renewal and network changes
  can reconnect the socket. The notice stays hidden for the first five seconds;
  persistent disconnection displays “Reconnecting…”. Save and recovery errors
  appear immediately.
- **Edits sync but cursors are missing:** tldraw hides presence from other tabs
  signed in as the same user. Use two different accounts to test cursors and
  presence. Cursor chat uses `/` on a desktop keyboard.

For page persistence checks, inspect `[data-testid="document-status"]` in the
browser's Elements panel and wait for `data-saved="true"` before reloading.
Routine save messages are intentionally hidden. Canvas undo uses the SDK's
native behavior: undoing a local edit can affect a later remote change to the
same shape, while unrelated remote shapes remain intact.

## Backups and database restore

Back up the full database so binary documents, native canvas rooms, projections,
history, tasks, and accounts stay together. SQL content projections alone do not
preserve collaboration identities or room clocks.

Before restoring a database snapshot, stop all app and worker writers, preserve
the current database, and export work created since the snapshot that must be
kept. Restore with an app revision compatible with that snapshot's schema.

A snapshot restore also needs a new collaboration URL/cache namespace, such as
a new worker hostname configured in both the worker and rebuilt app. Otherwise,
old browser Yjs updates can replay into the restored database. Retain old drafts
for manual recovery. An ordinary worker restart keeps the same URL and namespace.
