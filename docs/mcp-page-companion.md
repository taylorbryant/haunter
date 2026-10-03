# Use Haunter pages in a conversation

The page companion lets you select a workspace, find a page, read or edit it in Haunter’s real
editor, and add it as context for your next question. It runs inside hosts that
support [MCP Apps](https://developers.openai.com/plugins/build/chatgpt-ui).
The panel reads pages with your Haunter permissions.

## Connect and open the panel

1. Connect your host to Haunter's hosted MCP endpoint, normally `${APP_URL}/mcp`.
2. Complete the OAuth sign-in and approve **View only** for the workspaces you
   want to use. The companion also works with existing edit and full-access
   connections. To edit within the panel, choose Edit or Full access and explicitly
   enable **Allow editing in the embedded editor**. Existing connections default
   to read-only embedded access.
3. In a host with app entrypoints, open **Haunter** from the
   sidebar or conversation tabs. In other MCP Apps hosts, ask the assistant to
   open Haunter's page companion.
4. Select a workspace. Open a recently updated page from **Home**, browse the
   nested **Pages** list, or search for a page. Expand a parent to see its children.
5. Ask about **this page**. The panel automatically shares the current page's
   title, workspace name and ID, page ID, source URI, web URL, editor availability,
   and save status. The assistant can use those references to read the saved page.
   Click **Use as context** when you want to attach a fixed content snapshot.

The panel adds a saved snapshot with the page title, workspace, source URI,
update time, and document revision. Adding another page replaces the snapshot
from that panel. It leaves your conversation draft in place.

The larger plugin screen uses Haunter's workspace sidebar and document layout,
with navigation and conversation context staying visible as the document scrolls.
Breadcrumbs open parent pages or return to Home. Narrow panels show the page
browser first, then the document; use **Back to pages** to return. The conversation
context stays attached while you browse. The panel follows the host's light or
dark mode using Haunter's own theme colors and ghost mark.

Current-page metadata follows navigation, renames, and save-status changes. It
does not include the page body or your selection. Returning Home, switching
workspaces, refreshing, or completing the host's close handshake clears the current
page. Failed navigation keeps the existing page current. Access failures mark the
editor unavailable; save status can be unknown while loading or reconnecting.

An explicitly attached snapshot does not update automatically when you edit a page. Click
**Update context** to read and attach the current saved version. Use **Remove
context** to clear the panel's content attachment while retaining current-page
awareness. Browsing another page keeps the snapshot attached to its original page.
Hosts with OpenAI model-context extensions also reflect attachment removal from
the host interface; subsequent navigation shares metadata without restoring the
removed content. Context updates apply to future conversation turns and do not
trigger an assistant response on every click or keystroke.

If the host does not support text context updates, you can browse and edit permitted
pages, but automatic awareness is unavailable and the attachment button is disabled.
Hosts with text-only support receive the same page details in text; hosts supporting
structured context also receive separate `haunterView` and `haunterPage` fields for
the current view and explicit attachment. Metadata belongs to that panel's host
context; association with a particular thread depends on the host. A forced panel
destruction can prevent the close handshake from clearing its current-page metadata.

## Mention a page

Hosts that support the OpenAI composer mention extension can search Haunter
pages directly from the composer. Select a page from the host's mention menu.
Search returns up to 20 pages across your approved workspaces. An empty search
also returns pages to browse.

Each mention points to an authenticated resource such as:

```text
haunter://workspaces/example-workspace/pages/17c05b44-c652-4d83-92cf-83cbf7056ef2
```

Reading a mention checks your current connection and workspace membership.
Removing a workspace from the connection, disconnecting the agent, or leaving
the workspace prevents subsequent reads through existing mention references.
Entrypoint and mention availability depends on the host; see the
[MCP Extensions support table](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md).

## Editing pages

Page titles, icons, rich text, lists, tables, code, and callouts use the same
editor, save flow, and collaborative document as the web app. Existing task
text and checkboxes remain part of that document. Uploads, creating subpages or
canvases, page mentions, task assignment/due-date controls, and history are not
available in this embedded release. Existing canvas blocks offer **Open canvas**,
which opens the real canvas editor in the panel. Page links and mentions offer
**Open in Haunter**; their stored content is preserved.

Searching filters the sidebar without closing your editor. Leaving a page for
another page, workspace, Home, or Refresh waits for a confirmed save. If saving
fails, the page and its draft stay open. The host’s teardown handshake also
requests a save; a host that forcibly destroys the panel can interrupt it.
Local recovery storage remains a fallback, not a substitute for a confirmed save.

**Use as context** waits for saving and attaches the current stored page.
**Use selection as context** shares just the selected passage, marked as
potentially unsaved. Context snapshots include at most 60,000 characters of
page body. The source resource and `read_page` return the complete saved page.

The page browser shows up to 100 pages at a time; use search to find more.

Only pages in currently approved workspaces are available. Use **Refresh** after
changing a connection's workspace access. If the panel says the connection is
inactive, reconnect through the host and approve the intended workspaces.

## Editing canvases

Ask the assistant to open a canvas, or click **Open canvas** on a page's canvas
block. Drawing tools, text, shapes, the component/template library, and live
collaboration use the same editor as the web app. **Back to page** waits for a
confirmed save; offline changes keep the canvas open until they sync.

The assistant receives the current canvas and selected shape IDs automatically
when the host supports context updates. You can ask it to edit “these shapes.”
It reads the saved canvas and revision through `read_canvas`, then applies changes
through `edit_canvas`; the updates appear in the open editor. Drawing content and
selected text are not automatically attached. Selected IDs are limited to 100,
with a total count and completeness flag for larger selections.

The assistant can call `create_canvas_block` on a page and then
`open_haunter_canvas` with the returned ID. It can also open existing standalone
canvases by ID. Each canvas has its own scoped session under your existing
connection consent and current workspace role. Canvas browsing and history
remain available in the regular web app.

## Try the local preview

From a Haunter checkout, install dependencies and start the test host:

```bash
bun install --frozen-lockfile
bun run preview:mcp-app
```

Open [the local host](http://localhost:8797/). It starts the actual web app and
collaboration worker against a disposable database, with two workspaces and
multiple pages. It does not use your production account or credentials.
The editor opens without browser cookies. Use the synthetic sign-in only to
compare it with the ordinary web app. Stop with Ctrl+C to close the servers and
remove the temporary database. See the [editor verification guide](mcp-editor-proof.md)
for the automated browser checks and deployment requirements.

The companion resource is bundled automatically before `bun run dev`,
`bun run build`, and `bun run test`. After changing the panel during development,
run `bun run build:mcp-app` and reopen it in the host. Restart the local preview
to load an updated bundle. When releasing a changed UI, update the version in
its resource URI so hosts can refresh their cached resource.

Test in the intended host before deploying: confirm OAuth approval, panel
entrypoints, mentions, context attachment, and removal. The local preview
verifies the bridge with test data; host installation and launcher behavior
require that host's integration setup.
