# Collaborative editing release candidate

Page bodies use Yjs/Hocuspocus; canvases use first-party tldraw sync. BlockNote remains the page editor. SQL content is a readable projection for
search, sharing, exports, task extraction, backlinks, and history. Titles, page
hierarchy, and permissions keep their existing storage. A migration to Lexical
is independent of this cutover.

## What changed for the cutover

- Creating a page atomically creates its Yjs document and SQL projection. This
  includes onboarding, imports, recovery, and child-page creation.
- Browser editing always opens a collaborative document. No runtime read seeds
  from legacy JSON. The old body-save HTTP endpoint returns 409 so old tabs cannot
  overwrite the migrated document; it contains no legacy save implementation.
- Task actions, appends, and history restores write through the document repository.
  Restores advance the generation so old offline edits cannot undo a restore.
- Collaborative assignment notifications commit with the document and task rows.
  Assignment attribution follows the assignment transaction, not the most recent
  typist. Offline sync has unknown authorship and uses “A teammate.” Known
  self-assignments stay silent. Checkpoints have no individual author; explicit
  restores retain the restoring user's attribution.
- The worker owns a database lease, renewed every five seconds and valid for 30
  seconds. A second worker cannot start; expired owners cannot commit, even if
  they still have documents in memory. Deploy one replica with replacement, not
  overlapping rolling instances. HTTP task/appending transactions still work.
- `/health` returns 200 only while accepting connections, renewing the lease,
  and without failed document saves. Shutdown closes sockets and flushes saves
  before releasing ownership. Failed flushes are reported rather than acknowledged.
- Incoming updates are checked on a temporary document before they can be applied
  or broadcast. Unknown nodes, unsupported versions, duplicate block IDs, and
  oversized content fail without corrupting the shared document. Recovery downloads
  use compact base64; older byte-array downloads remain importable.
- Local IndexedDB updates are compacted after 128 writes. Unsynced copies and
  archived restore generations are retained; automatic eviction is intentionally
  absent so cleanup cannot silently discard an offline draft.

## One-time production cutover

1. Have both users sync their open tabs until they say **Saved to server**, export
   any remaining drafts, and close old tabs. Stop app and worker writers.
2. Take a **full database snapshot/branch** and retain the previous app revision.
   The task backup below contains page, canvas, and Yjs rows; it is not a replacement for a
   full backup of tasks, history, accounts, and other tables.
3. Install this branch's locked dependencies and apply all Drizzle migrations,
   including 0039–0043. Supply the target's environment securely; never commit it.
4. Run the dry-run, inspect its database hostname and counts, then apply using that
   exact hostname and an absolute, new backup filename. The task rejects source
   information loss or mismatched existing projections before writing anything.

```sh
bun install --frozen-lockfile
bun --env-file=.env.local node_modules/.bin/beignet db migrate
bun --env-file=.env.local node_modules/.bin/beignet task run documents.migrate --json
bun --env-file=.env.local node_modules/.bin/beignet task run documents.migrate \
  --input '{"dryRun":false,"expectedDatabase":"YOUR_DATABASE_HOSTNAME","backupPath":"/absolute/private/path/page-cutover.json"}' --json
bun --env-file=.env.local node_modules/.bin/beignet task run documents.migrate --json
```

The last run must report zero `converted`, zero `canvasesConverted`, and zero `projectionsUpdated`. Conversion
includes trash, preserves existing page binary identities and native canvas room clocks, leaves page timestamps alone,
and commits one resource at a time. If interrupted, retain the original backup and
rerun preflight; use a new backup filename for the remaining work. Do not edit
pages or canvases during conversion. Backup files are created exclusively with mode 0600.

5. Configure Next and the worker with the same database, auth secret, and canonical
   `APP_URL`. Set `NEXT_PUBLIC_COLLABORATION_URL=wss://YOUR_WORKER_HOST` **before
   building Next**, and at worker runtime. Production builds reject missing or
   insecure remote collaboration URLs. Allow WebSocket upgrades and keep the
   worker available continuously. The app accepts one canonical browser origin.
6. Start the worker, check `/health`, deploy/start Next, and reopen the app. Run the
   browser release checks below before inviting normal usage.

## Worker deployment

`Dockerfile.collaboration` is the deployment entrypoint. It installs the lockfile,
excludes local secrets from the build context, runs as the Bun user, and defines a
health check. Build with `docker build -f Dockerfile.collaboration -t haunter-collaboration .`.
Inject runtime secrets through the host. The container listens on port 1234;
terminate TLS at the host's proxy. Allow at least 30 seconds for graceful shutdown.
Use a persistent database, one worker replica, automatic process restart, and
alerts on sustained unhealthy status or lease/storage errors. The lease expiry
allows recovery after a crash without manually deleting ownership rows.

The worker boots the app providers, so it needs the same provider configuration as
Next (including mail configuration), even though it does not send sign-in emails.
The existing task notification schedule retries durable pending push deliveries;
keep the app's schedule enabled. The container built successfully with Fly's
remote builder on September 11, 2026. Its first boot and public HTTPS/WebSocket
smoke tests remain part of the production cutover below.

### Fly.io configuration

`fly.collaboration.toml` targets the `haunter-collaboration` app in the personal
Fly organization. Its public WebSocket URL is
`wss://collab.haunter.app`. The starting size is one shared CPU and
1 GB RAM in `iad`; review memory and CPU usage after the release rehearsal.
The service disables idle stopping, restarts after process exits, requests a
60-second graceful shutdown, and checks `/health` every 15 seconds.

Before the first worker start, enable Fly billing for continuous operation and
stage production values in Fly Secrets: `APP_URL`, `SQLITE_DB_URL`,
`SQLITE_DB_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM`.
Match the Next app's optional Blob, Upstash and web-push configuration when those
providers are enabled. Do not import redacted `[SENSITIVE]` values from a Vercel
environment export. Keep production and preview databases/workers separate.

Build the container before cutover without starting a worker:

```sh
fly deploy --config fly.collaboration.toml --remote-only --build-only --push
```

After the backup and migration steps above have completed, deploy exactly one
Machine and verify the result:

```sh
fly deploy --config fly.collaboration.toml --ha=false
fly machine list --app haunter-collaboration
fly checks list --app haunter-collaboration
curl --fail https://collab.haunter.app/health
```

Always retain `--ha=false`: Fly otherwise creates spare Machines by default.
The rolling strategy replaces the single Machine in place with one unavailable
Machine allowed; do not switch to canary or bluegreen, add replicas, or run a
local worker against the same production database. Database conversion is a
separate maintenance operation, never an automatic Fly release command.

Set Vercel's production `NEXT_PUBLIC_COLLABORATION_URL` to the URL above before
building the release. Keep `APP_URL` set to the canonical website origin.

Fly manages the TLS certificate for `collab.haunter.app`. In Namecheap's
Advanced DNS settings for `haunter.app`, configure these records using the
automatic TTL:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `collab` | `e59mjy1.haunter-collaboration.fly.dev` |
| CNAME | `_acme-challenge.collab` | `collab.haunter.app.e59mjy1.flydns.net` |

The DNS challenge allows certificate issuance before the worker starts. Keep
both records for routing and automatic certificate renewal. Verify issuance with
`fly certs check collab.haunter.app --app haunter-collaboration`; use
`fly certs setup collab.haunter.app --app haunter-collaboration` to retrieve the
current required records if the Fly app is recreated.

## Recovery and rollback

A worker outage leaves edits in IndexedDB. Restart the same worker/database and
wait for **Saved to server**. An expired login uses the existing sign-in recovery
flow. Save errors expose retry and download actions. Previous restore generations
can be downloaded and imported as new pages; they never overwrite the restored
page automatically. Browser recovery imports retain the existing 5 MB file /
2 MB binary-document limits; larger recovery files need offline handling. The
worker rejects documents above 8 MiB rather than acknowledging an unpersisted body.

For a bad release, stop both writers and preserve the current database before
rollback. Restore the **full pre-cutover snapshot** together with the previous app
revision. This returns data to the snapshot time, so first retain exports of any
post-cutover work. Do not point an old JSON-writing app at the migrated live DB.
Restoring a database snapshot also requires a **new collaboration URL/cache
namespace** (for example a new worker hostname) so old browser CRDT updates cannot
be uploaded into the rolled-back database. Keep old browser drafts available for
manual recovery. A normal worker restart must keep the same namespace.

## Validation performed on September 7, 2026

The disposable database `haunter-yjs-taylorbryant.aws-us-east-1.turso.io` contained
231 pages, including 66 in trash. The cutover converted 204 pages, preserved 27
existing Yjs identities, and canonicalized 19 existing SQL projections. The final
dry-run reported 231 existing documents, zero conversions, and zero projection
repairs. A private page/document backup was written before applying the cutover.

The full Beignet check and production Next build passed. All 585 tests passed.
A production browser check created a new page, saved its title and body, and verified
inline SQL after reload. Two tabs made separate paragraph/code edits with the worker
stopped; a reload retained local edits, and restarting the worker merged both edits.
Both tabs then reported **Saved to server**, and fresh loads retained the merged text.
The test page is **Yjs release candidate — browser check**.

Tests cover concurrent
binary writes, SQL projection rollback, task actions, tenant/role boundaries,
restore generations, offline sessions, lost storage, notification attribution,
worker lease fencing, and migration checks. See `yjs-performance.md` and
`yjs-browser-validation-2026-09-07.csv` for the earlier production performance run.

Release browser checklist:

- Create, rename, and edit a page; reload and verify paragraph and inline/fullscreen
  code, whitespace, headings, tables, and custom blocks.
- Edit from two tabs, stop/restart the worker, and verify both offline edits survive
  reload and converge to a server-acknowledged result.
- Expire auth while typing, sign back in, and verify the sidebar and editor recover.
- Restore history while another tab is offline; verify the prior draft is available
  for recovery and cannot resurrect the replaced document.
- Create/complete/reassign embedded tasks, verify task views, and check notification
  attribution with both users. Verify viewers cannot write and shares remain read-only.
- Repeat inline-code typing, repeated Return, selection, and reload on **real iPhone
  Safari**. Desktop browser automation does not validate that device's keyboard/IME.

The incoming-update validation microbenchmark (nine samples, local Bun) measured
median 1.41 ms / 11.09 ms / 28.49 ms for 100 / 1,000 / 3,000 blocks. This is worker
CPU time, not browser input latency. Earlier browser performance measurements remain
linked above; 3,000-block pages still deserve a real-device responsiveness check.

Production hosting/TLS, the Docker smoke test, and the real-device Safari pass are
release gates. This branch is a candidate for that final rehearsal, not evidence
that those deployment/device checks have already passed.

## First-party canvas sync

Canvases use `@tldraw/sync` / `@tldraw/sync-core` **5.3.2**, matching the editor.
The SDK owns the store, synchronization/rebasing, presence and undo. The custom
Yjs record bridge and custom history patch have been removed. Pages still use
Hocuspocus. Both protocols run in the same Bun worker and share its database lease:
page sockets use the root route; canvas sockets use `/canvas/:id`.

`canvas_sync_rooms.snapshot` stores the native RoomSnapshot, including record
clocks, schema and tombstones. `canvases.snapshot` is a readable document-only
projection used by public shares and exports. These update in one SQL transaction
with a revision compare-and-swap and worker-lease check. Native protocol messages,
including push acknowledgements, are held until persistence succeeds. Incoming
updates continue during SQL writes so fast drawing is coalesced into subsequent
commits. Failed saves retain the room in memory, report unhealthy status and leave
clients' changes unacknowledged.

Authentication uses resource-bound, short-lived tokens from
`POST /api/canvases/:id/sync-session`. The worker rechecks live membership, parent
page state, role and account session. Viewers receive native read-only sessions.
The small browser WebSocket adapter implements tldraw's public transport interface
so Haunter can pause/reconnect during sign-in recovery; it contains no record sync,
merge, presence, history or edit-queue implementation. Legacy whole-snapshot HTTP
writes return 409. New and recovered canvases seed native rooms transactionally.

### Browser recovery and behavior differences

- An open tab retains offline edits in tldraw's native queue and resends them after
  reconnection, including token renewal and worker restarts.
- Every mounted canvas also keeps its own account/workspace-scoped IndexedDB
  recovery copy. A durable server fingerprint matching the current document clears
  that copy. Storage failures keep the live value downloadable and trigger the
  existing navigation guard.
- The SDK does **not** persist its pending edit queue across reloads. After a reload,
  an unsynced copy can be recovered into a separate canvas or downloaded. It is
  never automatically loaded over the shared drawing. Copies already matching
  the freshly connected server document are discarded. A cold/offline load waits
  for sync; saved recovery copies remain available for download.
- **Native undo differs from the removed patch:** it can revert a collaborator's
  later change to the same shape and can resurrect a remotely deleted shape when
  undoing an earlier local change. Unrelated remote shapes survive undo. This is
  native tldraw 5.3.2 behavior; there is no private history override. Evaluate this
  interaction before release if simultaneous edits to the same shape are common.
- Existing inline asset storage is preserved; the 5 MB document content limit
  still applies. Moving large media to external asset storage is separate work.

### Upgrading the abandoned canvas-Yjs prototype

Production that still has JSON canvases uses the standard cutover above. For a
database that already ran the canvas Yjs prototype, migration 0043 drops its old
binary table. **Before applying 0043**, stop both writers, take a full database
backup, then verify the binary projections and retain a private backup:

```sh
bun --env-file=.env.local scripts/backup-canvas-prototype.ts \
  YOUR_DATABASE_HOSTNAME /absolute/private/path/prototype-canvases.json
```

This refuses an active worker lease, mismatched target, existing output filename,
or any canvas whose Yjs state differs from its SQL projection. Only then apply
0043 and run `documents.migrate` as above. The import-only Yjs decoder remains for
old exported recovery files; active canvas code never opens a Yjs document.

### Native migration validation — September 7, 2026

The disposable database's **30 canvases** passed binary-to-projection verification,
were backed up, then converted to native rooms. Its **233 page documents** were
unchanged. Backups on the validation machine:

- `/private/tmp/haunter-native-canvas-pre-schema-2026-09-07.json`
- `/private/tmp/haunter-native-canvas-cutover-2026-09-07.json`

Automated coverage uses real `TLSyncClient` instances over Bun WebSockets and
checks convergence, offline reconnect, durable acknowledgements, storage failures,
worker restart, viewers, token/resource boundaries, revoked access, migration
reruns, recovery into separate rooms and local recovery storage failures.

Production-build browser verification passed in the logged-in Codex browser:

- Two tabs received native text edits and undo/redo; reloading retained the drawing.
- Worker shutdown showed **Saved in this browser · Offline**. Restarting the worker
  saved an open tab's pending edit without a reload.
- A separate offline tab survived reload and recovered into a new canvas. The
  original drawing did not receive that abandoned queue's edits.
- Embedded/fullscreen canvas editing and the surrounding Yjs page both persisted.
- Direct database reads confirmed native room/projection equality for the original,
  embedded, and recovered fixtures. The recovered fixture is
  `7d17460a-5cf5-4da9-a614-bc6134fcfbbc`; it contains the offline recovery marker.
- Browser testing caught and fixed non-reactive socket status, recovery-copy
  selection, and current-user preferences. Server runtime deduplication removes
  duplicate tldraw module instances in Next's separate server runtimes.

`bun beignet check`, production build, migration rerun and both required impact
maps were run. The browser fixture edits are deliberately retained for inspection.
Real iPhone Safari, hosting/TLS, and the container smoke test remain release checks.
