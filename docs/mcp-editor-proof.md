# Haunter's real editor in an MCP App

The MCP workspace opens the existing React `PageEditor` and tldraw `CanvasSurface` in embedded routes. It uses
the same APIs, workspace roles, IndexedDB recovery, authenticated document
sessions, BlockNote editor, and collaboration worker as the web app.

The `open_haunter_editor` tool accepts a workspace ID and page ID. It checks the
MCP connection's current page access before returning an editor destination.
`open_haunter` opens the workspace browser; both tools share the same UI.
Its UI resource is `ui://haunter/workspace/v2`. The editor authenticates through
the approved MCP connection and a dedicated page- or canvas-scoped session. Existing
connections open read-only. Writable editing requires both a non-view MCP
profile and explicit **Allow editing in the embedded editor** consent. Current
workspace roles continue to apply. This consent permits changing and removing
content in the opened page or canvas; it does not add destructive agent tools.

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

Select text and click **Use selection as context** to send just that selection
to the conversation. Selection context is marked as potentially unsaved. **Use
as context** waits for a save receipt and reads the latest page
through MCP. Browsing and typing do not automatically attach page content.
Both actions recheck the MCP connection's current page access.

In another terminal, run the reproducible browser verification:

```bash
bun run verify:mcp-editor
```

It requires Playwright's Chromium installation. Screenshots are written to
`/private/tmp/haunter-editor-proof`, or to `MCP_EDITOR_PROOF_OUTPUT` when set.
The test writes additional lines and ends by revoking the disposable MCP
connection. Restart the preview before running it again or using the editor.

## What the local browser proof established

- Actual typing reaches Haunter's stored page, and saved context contains it.
- Page switches and returning Home retain pending edits and attached context.
- Workspace switching opens a new page-scoped session in the selected workspace.
- A disconnected collaboration socket blocks navigation and keeps the draft editable.
- Existing canvas blocks open the real canvas editor in the panel. Links and mentions offer the web app.
- Leaving an expanded code dialog retains its edits in the shared document.
- The ordinary web editor sees panel edits; web edits sync back to the panel.
- Explicitly selected live text reaches the MCP host's conversation context.
- Host appearance temporarily overrides Haunter's theme without replacing
  the user's saved web-app theme preferences.
- A 390px panel has no horizontal overflow, including collaborator presence.
- The editor opens under a different top-level site in a fresh browser with no cookies.
- Embedded session recovery renews access through the approved connection.
- Read-only consent disables editing, and direct API writes are rejected.
- Disconnect invalidates the credential and prevents reopening the editor.

The local host uses a synthetic MCP connection, rather than a full OAuth
installation. Workspace event streaming/live-session context is disabled in
this fixture; document collaboration and explicit selection context are real.
This release hides uploads, subpage/canvas creation, page mention insertion,
task assignment/date controls, and history. Existing canvas blocks open in the panel;
links and mentions retain their stored content and offer the web app. Rich-text and inline code
editing, title/icon updates, and task text/checkboxes remain available.
Recovery after forced host termination and an installed ChatGPT/Codex plugin
still require verification in the target host.

## Embedded canvases

`open_haunter_canvas({ workspaceId, canvasId })` opens a page-backed or standalone
canvas after checking current MCP access. The agent can create a canvas with
`create_canvas_block`, then pass the returned ID to the opener. Canvas blocks in
an embedded page have an **Open canvas** button; **Back to page** waits for saving.

The panel uses Haunter's native tldraw tools and local component/template library.
It shares canvas ID, parent page ID (when present), current tldraw page ID, selected
shape IDs (up to 100), total selection count, completeness and save status.
It does not automatically share drawing contents or selected text. The agent should
call `read_canvas` for saved shapes and the latest revision before `edit_canvas`.
Selection and editing availability clear when leaving the canvas or losing access.
An explicit page attachment remains a fixed snapshot while browsing a canvas.

Run `bun run verify:mcp-canvas` against a fresh local preview to exercise drawing,
MCP editing, web/panel synchronization, navigation, offline saving, host theme,
narrow layout and agent creation followed by opening. Screenshots are written to
`/private/tmp/haunter-canvas-proof`. Run this before `verify:mcp-editor`, which
revokes the disposable connection at the end.

Canvas recovery copies can be downloaded from the panel. Recovering a copy as a
new canvas still uses the regular web app. Canvas history, agent activity overlays,
and a canvas browser are outside this embedded release; existing canvas IDs can
be opened directly with the tool.

## Embedded authentication

1. The iframe generates a random proof secret and passes only its SHA-256
   challenge through the exact-origin, source, nonce, and request-ID bridge.
2. The app-only `authorize_haunter_editor` MCP tool checks the live connection,
   approved workspace, membership, and the requested page or canvas (including its parent page). Its result contains only a public
   handoff ID. Possessing this ID does not grant access.
3. The iframe posts the ID and proof secret directly to Haunter. The database
   consumes the handoff atomically, within 60 seconds, and issues a random
   credential. The credential remains in iframe memory; only its hash is stored.
4. Sessions last five minutes from issuance. The iframe obtains a new handoff
   before expiry and during recovery. It has no long-lived refresh credential.
5. Authenticated HTTP requests omit cookies and use `Authorization: HaunterEmbed`.
   The server checks current user approval, connection, OAuth consent, workspace
   scope, membership, page availability and expiry. The credential permits only
   page body/metadata reads, title/icon changes, view tracking, document sessions and its
   own verification endpoint. A canvas credential permits only its own canvas read,
   collaboration session, and verification endpoint. It cannot read its parent page,
   open another canvas, or call account APIs. Navigation requires a new handoff.
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
preserving existing page sessions. Deploy the web app and collaboration worker
with both migrations applied. The local proof and tests use migrated,
disposable databases; they do not migrate the production database.

The automated auth tests cover concurrent single-use redemption, invalid proofs,
expiry, cross-page/API boundaries, read-only credentials, membership downgrade,
OAuth consent deletion and scope removal, disconnect, reconnection and collaboration
scope. Consent checks require exact `haunter:mcp` membership in both direct and
Better Auth-encoded scope arrays. Mixed web/embedded collaboration tests verify
that accepted edits save through revocation while later embedded edits are rejected
and web edits continue saving.

## Host and deployment requirements

The MCP resource declares `ui.csp.frameDomains` for the exact `APP_URL` origin.
The editor route permits framing only by its own origin, `chatgpt.com`,
`web-sandbox.oaiusercontent.com`, and exact additional origins in
`MCP_EMBED_ALLOWED_ORIGINS` (comma-separated). Configure every actual ancestor
origin needed by the target host before building/deploying. This setting
controls framing; it does not trust host origins for authenticated API writes.
CSRF checks trust the configured public app origin and ordinary same-origin
requests.

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
