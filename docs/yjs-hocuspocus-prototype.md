# Yjs / Hocuspocus implementation notes

Current cutover and deployment instructions are in [the release candidate runbook](yjs-release-candidate.md). Historical browser measurements below remain useful; prototype rollout notes are superseded by that runbook.

The initial prototype moved **page bodies** to Yjs, kept BlockNote as the editor,
and used a separate Hocuspocus worker for synchronization and persistence. The
release candidate now also includes canvases, with a one-time cutover on the
disposable database. Titles, hierarchy, and permissions retain their existing
storage paths.

## Run it

Use the same database configuration and `BETTER_AUTH_SECRET` for Next and the worker.
Migrations `0039_outstanding_banshee.sql` and `0040_known_silver_centurion.sql` add
`collaborative_documents` and its restore generation without rewriting existing
pages. Both have been applied to the configured test database.

```sh
bun install
bun beignet db migrate
```

Set the following in `.env.local`, then run the two processes in separate terminals:

```dotenv
NEXT_PUBLIC_COLLABORATION_URL=ws://localhost:1234
```

```sh
bun run dev
bun run dev:collaboration
```

The worker defaults to `127.0.0.1:1234`. Optional `COLLABORATION_HOST` and
`COLLABORATION_PORT` change its listener. `APP_URL` determines the allowed browser
origin. Restart Next after changing public environment variables. A remote device
needs a reachable app URL and WebSocket URL; `localhost` on an iPhone points to the
phone itself. Use TLS for remote hosting and keep this test instance private.

The browser test page is **Yjs prototype — persistence test**:
`/w/xy7ifX3rZuz8PaU060t9qC01y3Vv8JPe/p/62809512-d8d2-46db-821c-61c5521a210b`.

## Data flow

1. Opening a page requests a five-minute, signed grant bound to the current user,
   session, workspace, and page. The worker checks the live session, membership,
   ban status, and page before connecting. Viewers receive read-only access.
2. Page creation or the offline migration creates the Yjs state. Worker loads
   require that persisted binary state, preserving CRDT identity. Clients never
   independently seed an empty document from JSON.
3. The editor binds directly to the shared `body` fragment. Incremental updates
   go to IndexedDB and the worker. Cache keys include the user, workspace, page,
   protocol version, and server URL. Cached bodies can mount without waiting
   for WebSocket synchronization.
4. The worker batches saves for 300 ms, with a maximum delay of two seconds.
   Each transaction commits the Yjs state and revision alongside readable SQL
   content, search text, task projections, backlinks, and periodic history
   checkpoints. A save receipt covers only the state captured by that transaction,
   including deletion-only changes.
5. The UI distinguishes local durability from server persistence. Disconnected
   changes stay editable locally and merge on reconnection. Session recovery can
   pause and resume the connection without replacing the editor's document.
   Navigation waits for IndexedDB transactions when needed.

Network synchronization uses Yjs updates. The database currently stores a compact
**full binary snapshot per save**, not an append-only update log. This deliberately
keeps the persistence prototype small; write amplification still needs measurement
on large pages. Document save receipts avoid retransmitting full page content.

Live access is rechecked before incoming messages after a five-second check window,
and every 30 seconds for idle connections. Grants renew every two minutes. Revocation
is therefore bounded rather than instantaneous. Already accepted edits can finish
persisting after a page is moved to trash, without recreating its task/link rows.

Only run **one collaboration worker**. Revision compare-and-set rejects competing
stale snapshot writes; this is not distributed document ownership or multi-worker routing.
Graceful shutdown stops accepting connections and flushes documents. If a flush
fails, the worker stays alive so pending state can be retried.

Task actions, MCP appends, and sidebar child-page creation now make targeted Yjs
changes inside their existing SQL transaction. This keeps task rows, backlinks,
notifications, and page creation atomic with the binary document update. The worker
checks revisions of loaded documents once per second, grouped by workspace, and
fetches only newer snapshots. Those committed updates merge into open editors without
replacing their existing nodes or unsaved typing. Browser typing still synchronizes
directly over WebSockets; external actions normally appear after the next one-second
check plus database/network latency. Worker saves also merge any newer committed
snapshot inside their transaction, covering the race before that check runs.

## Compatibility boundaries

- Existing block IDs, nesting, inline marks, mentions, code whitespace, tables,
  attachments, task properties, and page/canvas references are preserved by the codec.
  Server block definitions must remain aligned with the browser schema.
- Search, backlinks, shared-page reads, and exports continue reading SQL projections.
  Explicit page export/save flushes wait for server persistence and refresh that
  projection. Unsynced offline edits are not visible to server readers yet.
- Embedded-task changes from the Tasks view and notification completion now update
  the matching Yjs block properties. MCP `append_to_page` appends new blocks rather
  than resubmitting an older copy of the page. Sidebar child creation appends its
  parent link once on the server; the browser receives those same Yjs nodes.
  Root creation, imports that create pages, the editor's slash menu, and standalone
  tasks retain their existing behavior. Legacy full-body replacement remains blocked on converted pages. History
  restoration uses a fresh Yjs document generation and keeps the pre-restore
  server version in history. Titles and icons keep their existing values.
- Editor task changes update the task rows. Assignment notifications/delivery are
  not yet wired for collaborative batches; actor attribution needs a deliberate
  design rather than assigning every change to the last socket that sent an update.
- Previous durable drafts are offered as a download, not silently replayed over a
  collaborative document. Emergency recovery downloads retain the complete binary
  Yjs state and the latest title. **Pages → Recover drafts** imports these JSON
  files and older bare block-array downloads into new pages. Bundled canvases
  are copied and bundled page/canvas references remapped. Bodies receive fresh
  block and CRDT identities; recovery never merges a file into an existing page
  or resends historical assignment notifications. Referenced assets and drawings
  without bundled snapshots remain references. Imports are atomic and limited to
  5 MB per file, 20 pages and 20 canvases, with a 2 MB binary body limit. Markdown
  drafts use the existing Import Markdown action. Ordinary saved-page exports
  remain Markdown/HTML.
- The local cache survives page reloads while the collaboration worker is offline.
  The app shell and page metadata query still need the Next server. This is not a
  fully offline-installable application. Collaborative page loads and background
  polls use `/api/pages/:id/metadata`, which never selects or parses SQL content.
  The full-page endpoint remains available for exports and non-collaborative editing.
  IndexedDB hydration and the document connection start alongside the editor bundle.

## Restoration and offline copies

Restoring first flushes the initiating tab's pending page edits. The server then
checkpoints its current saved body, atomically replaces the binary state and SQL
projections, and advances a generation counter. A generation is included in signed
grants, WebSocket document names, and browser cache keys. The persistence transaction
rejects older-generation writes, including writes accepted just before the restore.
The worker retires old sessions; it never merges their state into the new document.

Open editors obtain the current generation from an authenticated endpoint, preserve
the previous document in IndexedDB, and mount the restored body without reloading
the app. Offline tabs do this on reconnect. If preserving the copy fails, the tab
keeps its old document and reports the storage error. The recovery notice offers
individual pre-restore copies as JSON downloads; import one with Recover drafts to
get its pending edits back in a separate page. Cache heads never move backwards
when a late tab finishes a previous restoration. Copies remain local and are not
an account backup; cache retention/cleanup remains a production follow-up.

This intentionally resets editor undo history across a restore. The saved history
checkpoint can undo the restore itself; unsent edits from other tabs are recoverable
copies, not automatic additions to the restored version. A page loaded offline may
briefly show its older cached body until the server can verify the current generation.

## Verification

`bun beignet check` runs architecture lint, strict registration checks, Biome,
TypeScript, and the complete test suite. New tests cover:

- Binary round trips for custom blocks, code, tables, and attachments.
- Save receipts that do not acknowledge later insertions or unsaved deletions.
- IndexedDB reloads and compaction without losing another tab's updates.
- Signed grants and current session/membership/page access checks.
- One-time seeding, legacy-writer fencing, atomic SQL/binary persistence, stale
  revision rejection, and task/backlink additions and removals.
- Two real WebSocket clients editing while disconnected, merging after reconnect,
  persisting deletion, and reloading from a restarted worker.
- Task actions, notification completion, MCP appends, and sidebar child creation
  on converted pages; delivery to an idle WebSocket client; merging with unsaved
  typing and deletions; viewer/tenant boundaries; invalid-write rollback.
- Recovery download preservation of collaborative state and title.
- Restore checkpoints and projection reconciliation, stale generation/grant
  rejection, offline sessions reconnecting without resurrecting edits, local
  recovery across reload/restart, storage failure and retry, and cache-head races.
- Binary/legacy recovery imports, independent document identities, canvas/link
  remapping, malformed file rejection, and tenant/role boundaries.

Browser checks completed in the logged-in Codex browser: create/edit/reload,
live edits across two tabs, edits in both tabs with the worker stopped, reload from
IndexedDB while it remained stopped, and convergence with a server save receipt
after restart. A cached document reported 18 ms for local hydration in one run.
That measurement excludes page queries, bundle loading, and editor mount; it is
**not** an end-to-end time-to-interactive result or a Liveblocks comparison.

Performance measurements, reproduction commands, and remaining browser checks are in
[the performance report](yjs-performance.md). Local CPU, payload, WebSocket, and
reconnect benchmarks and a 42-navigation desktop production matrix are complete.
Warm 1,000-block loads were below one second, but large-document typing and an
occasional cold synchronization outlier still need work before performance sign-off.

Inline and fullscreen code edits, paragraph edits, title/icon updates, and offline
two-tab convergence were also verified against the production build and disposable
remote database on September 7. Whitespace and edits survived reloads.
Still to verify manually: real iPhone Safari Enter/composition behavior,
sign-out/sign-in and account switching, quota exhaustion, fully cold browser caches,
and slow-network behavior. Typing in the 3,000-block stress page remains too slow.
History restore was also verified in two open browser tabs: both displayed the
restored body and a recovery notice without an app reload. The Recover drafts dialog
accepted a binary fixture and opened a new saved page with paragraph and code content.
The automated session test exports an actual pre-restore copy, imports it, and checks
that pending offline text survives; the in-app browser did not expose a download event
for the manual download action.

## Before a production migration

Add reliable notification delivery with correct attribution; define schema upgrade and invalid-update recovery;
add document size/rate limits, durable backup/restore, cache lifecycle controls, and
operational monitoring; design worker ownership/routing and failure recovery; then
finish production-browser cold/warm readiness, typing latency, and remote-database measurements.
The prototype's local-cache status should also be evaluated on real mobile storage.

Keep binary snapshots and SQL projections together when backing up. Turning the
feature flag off only makes sense for pages that have not converted: migrated pages
still reject old body writes. Returning to older app code requires first stopping
collaborative writers, draining their saves, and validating/exporting the final SQL
projection. Dropping the binary table discards CRDT history and is not a rollback
procedure for valuable data.
