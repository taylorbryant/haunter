# Haunter's real editor in an MCP App

The MCP workspace opens the existing React `PageEditor` and tldraw `CanvasSurface` in embedded routes. It uses
the same APIs, workspace roles, IndexedDB recovery, authenticated document
sessions, BlockNote editor, and collaboration worker as the web app.

The `open_haunter_editor` tool accepts a workspace ID and page ID. It checks the
MCP connection's current page access before returning an editor destination.
`open_haunter` opens the workspace browser; both tools share the same UI.
Its UI resource is `ui://haunter/workspace/v3`. The editor authenticates through
the approved MCP connection and a dedicated workspace-scoped session. Existing
connections open read-only. Writable editing requires both a non-view MCP
profile and explicit **Allow editing in the embedded editor** consent. Current
workspace roles continue to apply. This consent permits creating and editing pages, canvases, and tasks, organizing favorites, and moving pages to trash in approved workspaces. It does not add destructive agent tools.

## Run the proof

```bash
bun install --frozen-lockfile
bun run preview:mcp-editor
```

Open [the cookie-free embedded proof](http://localhost:8797/). The script starts a
local MCP host on port 8797, the real Next.js app on port 3097, and the real
collaboration worker on port 1397. It creates a disposable workspace and account;
it does not use your app environment credentials or production database.
The embedded editor needs no browser sign-in. Use [the synthetic sign-in](http://127.0.0.1:8797/login) only to compare it with the ordinary web app.
These ports must be available. Stop the process with Ctrl+C to stop the servers
and remove the fixture database.

Type in the page, then open the same page in the normal Haunter web app. Changes
sync in both directions. Switching pages, switching workspaces, returning Home,
and refreshing access wait for local durability and a server save receipt. If
saving fails or times out, the current editor stays open and resumes accepting
input. Searching only filters navigation and keeps the editor mounted. A host
that forcibly destroys its frame can interrupt the teardown handshake.

The current page and live selection update conversation context automatically.
Text selections are debounced (120 ms), limited to 12,000 characters, and marked
as potentially unsaved; a completeness flag identifies truncation. Clearing the
selection, navigating away, or losing access clears its context. Selecting an
inline canvas publishes its canvas and selected-shape IDs instead of page text.
No extra MCP read is needed for selection updates. The agent can call `read_page`
when it needs the full saved document. The React workspace shares Haunter’s page tree, favorites, search, creation dialogs, breadcrumbs, canvas list, and trash list. Page and canvas editing retain their existing save behavior.

In another terminal, run the reproducible browser verification:

```bash
bun run verify:mcp-editor
```

It requires Playwright's Chromium installation. Screenshots are written to
`/private/tmp/haunter-editor-proof`, or to `MCP_EDITOR_PROOF_OUTPUT` when set.
The test writes additional lines and ends by revoking the disposable MCP
connection. Restart the preview before running it again or using the editor.

## What the local browser proof established

- Actual typing reaches Haunter's stored page.
- Page switches and returning Home save pending edits and clear stale selection context.
- Workspace switching authorizes a new workspace session; page and canvas navigation within that workspace reuses it.
- A disconnected collaboration socket blocks navigation and keeps the draft editable.
- Existing canvas blocks render the real canvas editor inline. Page links and mentions open in the panel.
- Leaving an expanded code dialog retains its edits in the shared document.
- The ordinary web editor sees panel edits; web edits sync back to the panel.
- Selected live text automatically reaches the MCP host's conversation context.
- Host appearance temporarily overrides Haunter's theme without replacing
  the user's saved web-app theme preferences.
- A 390px panel has no horizontal overflow, including collaborator presence.
- The editor opens under a different top-level site in a fresh browser with no cookies.
- Embedded session recovery renews access through the approved connection.
- Read-only consent disables editing, and direct API writes are rejected.
- Disconnect invalidates the credential and prevents reopening the editor.

The local host uses a synthetic MCP connection, rather than a full OAuth
installation. Workspace event streaming/live-session context is disabled in
this fixture; document collaboration and automatic selection context are real.
The embedded workspace supports page/subpage and standalone canvas creation,
favorites, page moves, reversible archiving, inline canvas creation, and page
mentions, uploads, page history/restore, sharing, export, and recovery. Task assignment/date controls
are enabled in the workspace embed; the legacy document-scoped proof has no roster grant. Rich-text and inline code editing, title/icon updates, and task
text/checkboxes remain available.
Recovery after forced host termination and an installed ChatGPT/Codex plugin
still require verification in the target host.

## Embedded canvases

`open_haunter_canvas({ workspaceId, canvasId })` opens a page-backed or standalone
canvas after checking current MCP access. The agent can create a canvas with
`create_canvas_block`, then pass the returned ID to the opener. Canvas blocks in
an embedded page render inline, including their expand control. Page navigation
waits for both page and canvas saves; an offline canvas keeps the page open.

The panel uses Haunter's native tldraw tools and local component/template library.
It shares canvas ID, parent page ID (when present), current tldraw page ID, selected
shape IDs (up to 100), total selection count, completeness and save status.
Canvas context contains identifiers rather than the full drawing contents. The agent should
call `read_canvas` for saved shapes and the latest revision before `edit_canvas`.
Selection and editing availability clear when leaving the canvas or losing access.
The context follows the current page or canvas instead of retaining a fixed page snapshot.

Run `bun run verify:mcp-canvas` against a fresh local preview to exercise drawing,
MCP editing, web/panel synchronization, navigation, offline saving, host theme,
narrow layout and agent creation followed by opening. Screenshots are written to
`/private/tmp/haunter-canvas-proof`. Run this before `verify:mcp-editor`, which
revokes the disposable connection at the end.

Canvas recovery copies can be downloaded or recovered as a new canvas inside the
workspace panel. Legacy document-only embeds still require the web app for recovery.
Canvas history and agent activity overlays remain outside this embedded release.
Standalone canvases appear in the sidebar and can also be opened by ID.

## Embedded authentication

1. The iframe generates a random proof secret and passes only its SHA-256
   challenge through the exact-origin, source, nonce, and request-ID bridge.
2. The app-only `authorize_haunter_workspace` MCP tool checks the live connection,
   approved workspace, membership and embedded editing consent. Its result contains
   only a public handoff ID. Possessing this ID does not grant access.
3. The iframe posts the ID and proof secret directly to Haunter. The database
   consumes the handoff atomically, within 60 seconds, and issues a random
   credential. The credential remains in iframe memory; only its hash is stored.
4. Sessions last five minutes from issuance. The iframe obtains a new handoff
   before expiry and during recovery. It has no long-lived refresh credential.
5. Authenticated HTTP requests omit cookies and use `Authorization: HaunterEmbed`.
   Every request rechecks user approval, connection, OAuth consent, approved
   workspace, current membership and expiry. An explicit contract allowlist admits
   page/canvas browsing, creation, metadata updates, favorites, page trash/restore,
   history/restore, sharing, recovery import, view tracking and collaboration sessions.
   Writes require the current effective role to permit editing. Account, Markdown
   import, permanent deletion and unrelated
   APIs remain unavailable. Resource IDs are resolved through the session's tenant;
   a request cannot select another workspace. Page availability and canvas parent
   availability are also rechecked by collaboration workers.
   Legacy `authorize_haunter_editor` page/canvas grants retain their narrower
   document scope; migration does not turn them into workspace credentials.
6. Collaboration tokens reference the embedded session and stable connection.
   The worker checks embedded access before accepting each message. Revocation
   blocks subsequent updates; updates accepted while authorized finish saving,
   even if access changes during the save debounce. Accepted updates are already
   shared with other editors, so persistence never rolls back that shared document
   or depends on the last editor retaining access. Ordinary browser collaboration
   keeps its existing auth path. Reauthorization
   and disconnect delete existing embedded sessions, preventing old credentials
   from reviving on reconnect.

`drizzle/0045_blushing_frank_castle.sql` adds the session table and defaults all
existing connections to read-only embedded access. Apply this migration to the
target database before deploying. `0046_right_mauler.sql` adds canvas scopes while
preserving existing page sessions. `0047_little_mariko_yashida.sql` adds an explicit
`scope` column, defaulting existing rows to `document`. Deploy the web app and
collaboration worker with all three migrations applied. The local proof and tests use migrated,
disposable databases; they do not migrate the production database.

The automated auth tests cover concurrent single-use redemption, invalid proofs,
expiry, cross-page/API boundaries, read-only credentials, membership downgrade,
OAuth consent deletion and scope removal, disconnect, reconnection and collaboration
scope. Consent checks require exact `haunter:mcp` membership in both direct and
Better Auth-encoded scope arrays. Mixed web/embedded collaboration tests verify
that accepted edits save through revocation while later embedded edits are rejected
and web edits continue saving.

## Host and deployment requirements

Set `MCP_UI_DOMAIN=https://mcp-ui.haunter.app` at both build time and runtime
for the production connector. Use a separate value such as
`https://mcp-ui-test.haunter.app` for a separately installed test plugin. Keep each
value stable across deployments. It is a UI identity, not an API URL: no DNS
record or additional server is needed for this OpenAI-hosted sandbox setup.

The resource advertises `_meta.ui.domain` and the compatibility alias
`openai/widgetDomain`. OpenAI's connector host maps the hostname to an HTTPS
sandbox by replacing dots with hyphens. For the production example, this is
`https://mcp-ui-haunter-app.web-sandbox.oaiusercontent.com`. The shared parser adds
that exact origin to Next's `/embed` framing policy. The setting must be an exact
HTTPS DNS origin without a port, path, query, credentials, or fragment; its hostname
must fit the host's 63-character sandbox label. Invalid configuration fails closed.

The MCP resource still declares `ui.csp.frameDomains` for the exact `APP_URL`
origin where the real editor runs. Its framing policy also permits its own origin,
`chatgpt.com`, and `web-sandbox.oaiusercontent.com`. No wildcard sandbox domains or
request-supplied origins are automatically trusted. This framing policy does not
expand authenticated API origins or change the proof-bound authorization exchange.

`MCP_EMBED_ALLOWED_ORIGINS` remains an optional comma-separated list of exact
additional ancestors for local previews and other hosts. When `MCP_UI_DOMAIN` is
unset, the host's default identity behavior remains. Direct local HTTP/stdio MCP
connections and other hosts may ignore UI-domain metadata; inspect their actual
ancestor chain and configure exact additional origins when needed. Desktop custom
origins shaped like `codex-sandbox://mcp-app-<hex-id>.web-sandbox.oaiusercontent.com`
remain supported explicitly, with exact source/origin/nonce checks.

Changing the UI identity can change the iframe's browser storage partition. Save
pending edits and export any unsynced recovery copies before reopening under the
new identity. The `v3` resource URI refreshes the UI resource; a host with a cached
tool catalog may also need its connector refreshed before reopening. Verify two
separate connector installations use the same configured sandbox origin without
server allowlist changes. Host-specific domain behavior must be rechecked when
supporting another host; it is not guaranteed by the MCP Apps protocol alone.

OpenAI's [embedded-page guidelines](https://developers.openai.com/plugins/plugin-guidelines#iframes-and-embedded-pages)
permit embedding full editors from the MCP server's registrable domain with a
declared frame domain. Use a supported host with nested iframe support, a
non-opaque UI origin, and an app/MCP deployment on the same registrable domain.
Verify HTTPS, OAuth linking, embedded-session handoff/renewal, ancestor CSP, collaboration sockets,
and host teardown in the intended installed host before treating this as ready
for release.

The UI bundles are built before development, production builds, and tests.
Restart the preview after changing its bundled wrapper. Version the UI resource
URI when releasing changes to a host that caches resources.

## Workspace navigation and creation proof

Run `bun run verify:mcp-navigation` against the disposable local preview. It
checks shared page/subpage creation, internal links, breadcrumbs, search, favorites,
drag-and-drop moves, slash-menu page/canvas creation, archive/restore and standalone
canvas creation. It records requests and asserts that these human UI actions make
zero MCP tool calls and preserve the original iframe. Screenshots are saved under
`/private/tmp/haunter-navigation-proof`.

The MCP HTML resource now contains only the host adapter and one persistent
`/embed/workspace` iframe. The React workspace calls ordinary Beignet HTTP contracts
through `sessionFetch`; page bodies and canvases continue to use the collaboration
worker. MCP supplies assistant tools and the initial/renewed authorization handoff.
Current view and selection travel over the checked postMessage bridge to the host's
model-context API. Assistant opener results become React navigation requests, rather
than replacing the iframe. Each navigation waits for local and remote saving.
Archive waits for page and canvas saves before deletion, then releases the removed
view without attempting another save against a trashed document.

The old `get_haunter_workspace` and `act_in_haunter_workspace` tools and document
routes remain for already-open older panels. Their authorization tests still run;
the newly bundled host adapter does not use those UI tools or the legacy vanilla
workspace controller. Regular web components use their normal Next navigation;
the embedded surface provides a React navigation adapter with no web-route prefetch.

Both entrypoints compose `WorkspaceSidebar`, `WorkspaceHeader`, and the same
responsive `WorkspacePicker`. The web wrapper supplies notifications, account and
workspace management actions. The embedded wrapper supplies its scoped workspace
list, local appearance preferences, existing creation actions, and save guards.
The shared header reads the active route through the navigation adapter so its save
indicator also follows embedded page changes and opens the shared page history dialog.
The page action menu provides favorites, sharing, Markdown/HTML export and trash.
Markdown import and workspace management remain web-only.

## Home and Tasks proof

The embedded workspace renders the web app's `HomeView` and `TasksView`, including
today's tasks, upcoming tasks, favorites, recent pages/canvases, and the shared task
composer, list, assignment picker and due-date controls. Filters navigate through
the React workspace adapter without reloading the iframe. Human task actions use
the existing HTTP contracts; the member picker uses a workspace-scoped member
contract through the same session transport. Task writes require explicit editing
consent and a writable workspace role. Switching workspaces or closing the panel
waits for pending task writes before releasing its credential.

Run `bun run verify:mcp-tasks` against the disposable preview to check creation,
editing, assignments, due dates, completion, filters, regular web-app persistence,
narrow layouts and read-only access. Screenshots are saved under
`/private/tmp/haunter-tasks-proof`. Task/member authorization tests also cover
cross-workspace requests, read-only consent, legacy document grants, membership
downgrades and revocation. No database migration is needed for these screens.

## Appearance and sidebar proof

Run `bun run verify:mcp-appearance` against the disposable local preview. It checks
Dracula in the shell, real page editor and inline canvas; named light themes;
explicit theme persistence across host updates and reopening; Follow host; desktop
sidebar persistence; and narrow navigation without replacing the active frame.
It also verifies desktop and mobile workspace switching, web management dialogs,
the embedded control restrictions, and that the web app retains its appearance
preferences.
Screenshots are saved under `/private/tmp/haunter-appearance-proof`.

The React shell uses `app/globals.css` and `lib/themes.ts` directly. Host light/dark
updates cross the exact-origin, source and nonce-checked bridge. Named themes are
selected locally in React and applied as a temporary `forcedTheme`. Embedded theme
and sidebar preferences use their own storage keys; the shared SidebarProvider does
not write the normal web sidebar cookie when embedded.


## Task selection and assistant navigation

`open_haunter` accepts `workspaceId`, `view` (`home` or `tasks`), `filter`, `scope`,
and an optional `taskId`. A task requires an explicit workspace and is looked up
through the scoped `list_tasks` capability before navigating. The exact-ID filter
runs before pagination, excludes tasks on trashed pages, and does not grant any
additional access. Focused tasks use All/Everyone so completed or unassigned tasks
remain visible. Assistant navigation reuses the iframe and waits for pending saves.

A task observer wraps the shared Home/Tasks components only in the embed. Context
contains filters, date bounds, up to 200 visible IDs per list, loading/save status,
and the selected task's fields. Changes are coalesced for 120 ms; full list bodies
are not exported. A host-dismissed task stays dismissed across field/save updates.
Inline task context uses the page ID and source block ID, with `taskId: null`;
assistants must read the saved page and use page-block editing rather than treating
a block ID as a task ID. Existing text/canvas context and exact-origin messaging
remain in place.

Run `bun --no-env-file scripts/verify-mcp-task-context.ts` against the disposable
preview for selection, filtering, inline controls, web persistence, assistant
navigation, read-only consent, and context checks.


## History, recovery, and page actions

The workspace panel reuses `HeaderPageActions`, `PageHistoryDialog`, `SharePanel`,
and `RecoveryImportDialog`. History previews load private images with the embedded
credential. Restoring first flushes current edits, preserves the replaced content
as a history entry, and reconnects the mounted editor to the new document generation.
Canvas references in page history show a static explanation: restoring page content
does not roll back the drawing stored separately from that page.

The shared action menu publishes/revokes public page links and downloads Markdown or
HTML. HTML export fetches private images through `sessionFetch` so both cookie-auth
and embedded sessions work. Clipboard-write permission is requested through MCP UI
metadata and delegated to the workspace iframe; hosts may deny it, in which case
the public link remains selectable for manual copying.

The Pages menu accepts Haunter recovery JSON as new pages/canvases, and unsynced
canvas copies can be recovered directly from their notice. Navigation and sidebar
caches follow the new resources. Recovery leaves the original content intact.
These APIs require workspace-scoped edit consent and current edit membership;
history reads use workspace read access. Legacy document-only grants cannot use
the new routes. No new database migration is needed for this slice.

Run `bun --no-env-file scripts/verify-mcp-page-actions.ts` against the disposable
preview for history/restore (including failure and retry), private-image previews,
publish/copy/revoke, Markdown/HTML downloads, recovery-file import, unsynced canvas
recovery and regular-web UI checks. Screenshots go to
`/private/tmp/haunter-page-actions-proof`. The embedded authorization tests cover
read-only consent, cross-workspace access, role downgrades and revoked connections.

## Files and images

The workspace embed uses the shared BlockNote file picker, paste, and drop flow.
PNG, JPEG, GIF, WebP, PDF, text, Markdown, CSV, JSON, and modern Office documents
are supported, up to 10 MB each. Workspace edit consent is required for uploads;
legacy document-only embeds retain their narrower upload restrictions.

Embedded uploads use same-origin multipart HTTP with the in-memory HaunterEmbed
credential. Private previews and downloads use authenticated HTTP and temporary
blob URLs scoped to the mounted editor. Saved blocks retain stable `/api/files/`
URLs. File reads check the source page, active workspace, and current session;
archived pages, foreign workspaces, and revoked sessions cannot read attachments.
Responses are private/no-store. Navigation waits for pending uploads before
flushing the page body. The ordinary web app retains cookie-authenticated reads
and its existing upload strategy.

MCP exposes `list_page_attachments` (50 entries per page of results) and
`read_page_attachment`. Reads use an existing block ID, never arbitrary external
URLs. Text is bounded to 64 KB; images and binary resources to 5 MB. Images are
native MCP image content; PDFs and Office documents are binary resources, whose
rendering/extraction depends on the host. File bytes cannot be edited through
MCP. Existing `edit_page_blocks` can update attachment captions/display names or
move blocks while preserving the private file URL and content.

Run `bun --no-env-file scripts/verify-mcp-attachments.ts` against the disposable
preview to verify uploads, authenticated previews/downloads, native MCP reads,
live caption edits, navigation, and persistence in the regular web app. Preview
file storage is disposable and separate from the tunnel and production.
