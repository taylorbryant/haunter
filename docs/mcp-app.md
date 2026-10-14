# MCP App integration

Haunter's MCP App opens a React workspace inside a supporting host. It shares
the web app's navigation, Home and Tasks views, BlockNote page editor, and tldraw
canvas editor. This document covers maintaining that integration; tool usage is
documented in the [page](mcp-page-editing.md) and [canvas](mcp-canvas-editing.md)
references.

## Host integration

The host connects to the [hosted MCP endpoint](deployment.md#hosted-mcp) with a
user-approved workspace grant. `open_haunter` opens Home or Tasks;
`open_haunter_editor` opens a page; `open_haunter_canvas` opens a drawing. The host
must support MCP Apps, nested iframes, and a non-opaque UI origin.

Editing requires both a writable MCP profile and explicit **Allow editing in the
embedded editor** consent, plus a current workspace role that permits editing.
Without that consent, the panel is read-only. Workspace credentials permit the
supported page, canvas, task, sharing, and recovery operations; they do not permit
account administration, Markdown import, or permanent deletion.

The HTML resource contains a host adapter and one persistent `/embed/workspace`
iframe. Human actions in React use ordinary authenticated HTTP contracts. Page
and canvas edits use the collaboration worker. MCP handles agent tools and
authorization handoffs. Assistant opener results navigate the existing iframe.
Navigation and the host's close handshake wait for pending saves; a failed save
keeps the editor open. Forced frame destruction can interrupt that handshake.

Embedded appearance is saved per user, separately from the web-app preference.
**Follow host** uses the host's light/dark mode; named themes require an explicit
selection. Sidebar collapse state uses local storage. With focus inside Haunter,
Search accepts Cmd/Ctrl+K and Cmd/Ctrl+Shift+K to accommodate host shortcuts.

## Authentication and authorization

The embed does not depend on third-party cookies:

1. The iframe generates a proof secret and sends its SHA-256 challenge through
   a bridge that checks message origin, source, nonce, and request ID.
2. The app-only `authorize_haunter_workspace` tool checks the live MCP connection,
   approved workspace, membership, and editing consent. It returns a public
   handoff ID, which does not grant access by itself.
3. The iframe posts that ID and its proof secret directly to Haunter. Redemption
   is atomic, single-use, and limited to 60 seconds. The resulting credential
   stays in iframe memory; the database stores its hash.
4. Sessions last five minutes. Renewal obtains another handoff through MCP.
   HTTP requests omit cookies and use `Authorization: HaunterEmbed`.
5. Every request rechecks user approval, connection consent, workspace membership,
   expiry, and the contract allowlist. Resource lookup uses the session's tenant.
   Document-scoped credentials are restricted to their original page or canvas.

Collaboration tokens reference the embedded session and connection. The worker
checks access before accepting messages. Revocation blocks subsequent updates;
updates accepted while authorized finish saving because they may already have
been shared with other editors. Disconnecting or reauthorizing a connection
invalidates its existing embedded sessions.

Apply the checked-in database migrations before deploying, as described in
[Deployment](deployment.md). Keep the web app and worker compatible when changing
session validation or collaboration commands.

## Host identity and framing

Set `MCP_UI_DOMAIN` identically at web-app build time and runtime. For the
production connector, use `https://mcp-ui.haunter.app`; a separate test connector
should use a separate stable identity. This OpenAI sandbox identity does not need
a DNS record or an additional Haunter server.

Haunter advertises `_meta.ui.domain` and `openai/widgetDomain`. The configured
hostname maps to an exact HTTPS sandbox origin; for the example above,
`https://mcp-ui-haunter-app.web-sandbox.oaiusercontent.com`. Haunter includes that
origin in the `/embed` framing policy. The configuration must be an exact HTTPS
DNS origin without credentials, port, path, query, or fragment, and its hostname
must fit a 63-character sandbox label. Invalid configuration fails closed.

The resource declares the app's exact `APP_URL` in `ui.csp.frameDomains`. The
app/MCP deployment must share a registrable domain for OpenAI-hosted embedding.
`MCP_EMBED_ALLOWED_ORIGINS` adds exact ancestors for local previews or other hosts.
Hosts that ignore UI-domain metadata may need their actual ancestor chain listed
explicitly, including supported `codex-sandbox://mcp-app-<hex-id>…` origins.
Do not substitute wildcard sandbox domains or trust request-supplied origins.
Framing permission does not grant API access.

Changing the identity can change the browser storage partition. Save pending
edits and export unsynced recovery copies before changing it. Refresh the host's
connector/tool catalog and reopen the panel after resource changes. Host support
for UI identity, mentions, clipboard access, and teardown must be checked in that
host; the local fixture does not establish it.

## Conversation context

The panel publishes its current view and selection through the checked bridge
to the host's context API. Updates apply to future turns and do not send an
assistant message. Hosts may accept structured context, text context, or neither.

- Pages share identity, title, save status, and live selection. Text selection
  updates are debounced by 120 ms, capped at 12,000 characters, and marked when
  incomplete or potentially unsaved. Use `read_page` for saved content.
- Canvases share canvas/page IDs, selected shape IDs (up to 100), total selection
  count, and save status. Use `read_canvas` for saved shapes and a revision.
- Home and Tasks share filters, up to 200 visible IDs per list, and the selected
  task's fields. Inline tasks identify their page and source block; a block ID
  is not a standalone task ID.

Navigation, selection clearing, and access loss clear or replace context. A
selection dismissed in the host is not reattached by a save-status update.
Forced frame destruction can prevent context withdrawal. Selection alone does
not authorize a write, and local edits may not yet match the saved revision.
The separate [live-context tools](mcp-live-context.md) let agents discover regular
Haunter browser tabs without relying on an embedded panel.

Hosts supporting composer mentions can search approved pages and attach an
authenticated resource such as `haunter://workspaces/WORKSPACE_ID/pages/PAGE_UUID`.
Each resource read rechecks connection and workspace access.

## Local verification

Install dependencies and Playwright Chromium, then start the disposable host:

```bash
bun install --frozen-lockfile
bunx --bun playwright install chromium
bun run preview:mcp-editor
```

Open [the local host](http://localhost:8797/). It starts Next on port 3097 and the
collaboration worker on port 1397 using synthetic accounts and a disposable
database. The iframe requires no browser sign-in. The
[fixture sign-in](http://127.0.0.1:8797/login) opens the ordinary web app for
comparison. Ctrl+C stops the processes and removes the fixture database.

With the preview running, use the checks relevant to the change:

| Command | Exercises |
| --- | --- |
| `bun run verify:mcp-editor` | Page editing, synchronization, navigation, context, and revocation |
| `bun run verify:mcp-canvas` | Drawing, MCP edits, saving, and web/panel synchronization |
| `bun run verify:mcp-navigation` | Creation, links, favorites, moves, and trash |
| `bun run verify:mcp-tasks` | Task creation, assignments, dates, filters, and read-only access |
| `bun run verify:mcp-appearance` | Themes, persistence, and responsive navigation |
| `bun --no-env-file scripts/verify-mcp-task-context.ts` | Task selection and assistant navigation |
| `bun --no-env-file scripts/verify-mcp-page-actions.ts` | History, sharing, exports, and recovery |
| `bun --no-env-file scripts/verify-mcp-attachments.ts` | Uploads, private file reads, and persistence |

Checks write screenshots under `/private/tmp/haunter-*-proof`. Start from a fresh
preview when repeating checks; `verify:mcp-editor` revokes the fixture connection
and should run last. The fixture does not exercise OAuth installation, workspace
event streaming, or live-session reporting. Test those in the intended host.

The MCP bundle is built by the dev, build, and test scripts. After changing the
host adapter, rebuild with `bun run build:mcp-app` and restart the preview.
Version the UI resource URI when releasing changes to hosts that cache resources.
