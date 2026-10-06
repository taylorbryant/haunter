# Use Haunter pages in a conversation

The page companion lets you select a workspace, find a page, read or edit it in Haunter’s real
editor, and share the current page and selection for your next question. It runs inside hosts that
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
   Select a passage or canvas shapes to make your selection available automatically.

The larger plugin screen uses Haunter's workspace sidebar and document layout.
Breadcrumbs open parent pages or return Home; save status and a small page-actions
menu sit beside them. Use **New page** or **New canvas** in the sidebar. The page
menu creates subpages, adds/removes favorites, moves pages, and moves a page and
its descendants to trash. **Undo** restores the last archived page during this
panel session. Moving offers the workspace root and eligible parent pages; a
page cannot move inside itself or its descendants. Standalone canvases and
favorites appear in the sidebar. These controls require embedded editing consent.
**Open in browser** is in that menu. The sidebar button beside the breadcrumbs
collapses or expands navigation while keeping the current editor and selection.
On narrow panels it switches between navigation and the document. **Back to pages**
returns Home (or to the parent page of an inline canvas).

Open **Appearance** (the palette icon in the toolbar) to choose any Haunter theme,
including Dracula. The choice applies to the sidebar, editor and canvases.
**Follow host (light/dark)** tracks the host's color mode; MCP's standard theme
field does not include a named theme such as Dracula. Choose Dracula explicitly
to use Haunter's Dracula palette. The panel remembers its theme and desktop sidebar
preference when host storage is available, separately from your web-app preferences.

**Home** shows your tasks for today and the coming week, favorites, and recently
viewed pages and canvases. Add a task directly on Home or use **New task** in the
sidebar. **Tasks** provides the web app's task list: create or rename standalone
tasks, complete or reopen them, assign workspace members, set due dates and times,
and filter Open/Completed/All or Mine/Everyone. Tasks linked to a page open that
page inside the panel. These changes appear in the regular web app too. Editing
requires the connection's embedded editing consent and a writable workspace role.

Click or focus a task to share its identity, title, completion, assignee, and
schedule automatically. Home and Tasks also share the current filters and visible
task IDs, so you can ask about “this task” or the list you are viewing. Selecting
a task does not send an assistant message. Changing views or filters clears the
selection. The assistant can open **Tasks**, apply filters, or focus a specific
task using `open_haunter`; focused tasks include completed tasks. Use **Show all
tasks** to return to the list.

Current-page context follows navigation, renames, save status, and selection.
Selected text can include unsaved edits; up to 12,000 characters are shared, with
a completeness flag for larger selections. Clearing the selection removes its
text. Selecting a canvas replaces the text selection with its canvas and selected
shape IDs. The full page body is available through `read_page` when needed.

Returning Home, switching workspaces, refreshing, or completing the host's close
handshake clears the current page and selection; Home publishes its task view instead. Failed navigation keeps the
existing page current. Losing access clears selection and marks the editor
unavailable. Save status can be unknown while loading or reconnecting. If you
remove selection context using the host's interface, the same selection is not
reattached by a save-status update; selecting something else shares the new selection.
Context updates apply to future turns and do not trigger an assistant response.

If the host does not support text context updates, you can still browse and edit
permitted pages. Hosts with text-only support receive the same details in text;
hosts supporting structured context also receive a `haunterView` field. Metadata
belongs to that panel's host context; association with a particular thread depends
on the host. Forced panel destruction can prevent the close handshake from
clearing current-page context.

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
text and checkboxes remain part of that document. Use **/Page** to create a linked subpage at the cursor, **/Canvas** to insert an
inline drawing, **/Task** to insert a task, and **@** to mention another workspace
page. Change assignments and due dates directly on inline tasks using the same
controls as the web app. Clicking or focusing an inline task shares its page and
block identity along with its live fields. Upload images and documents using the
shared editor controls. Open page history from the edited-time label to preview or
restore a checkpoint. The page actions menu includes sharing and Markdown/HTML
export; the Pages menu includes Recover drafts for downloaded recovery copies. Existing canvas blocks render the real canvas editor inline, with an expand control. Page links and mentions display their titles and open inside the panel. Ordinary
links to Haunter pages also navigate within the panel. Access is checked again
for the destination, and navigation waits for a confirmed save.

Searching filters the sidebar without closing your editor. Leaving a page for
another page, workspace, Home, or Refresh waits for a confirmed save. If saving
fails, the page and its draft stay open. The host’s teardown handshake also
requests a save; a host that forcibly destroys the panel can interrupt it.
Local recovery storage remains a fallback, not a substitute for a confirmed save.

Selection sharing is automatic and does not request a saved-page snapshot.
The assistant can use the source resource or `read_page` to read the full saved page.

The page browser shows up to 100 pages at a time; use search to find more.

Only pages in currently approved workspaces are available. Use **Refresh** after
changing a connection's workspace access. If the panel says the connection is
inactive, reconnect through the host and approve the intended workspaces.

## Editing canvases

Use a canvas directly inside its page, expand it, or ask the assistant to open it. Drawing tools, text, shapes, the component/template library, and live
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
canvases by ID. Pages and canvases share a short-lived session for the approved workspace. Both
respect your connection consent and current workspace role. Open **Canvases** in the
sidebar for the canvas library; canvas history remains in the regular web app.

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
to load an updated bundle. Reopen the panel to pick up an updated resource. A resource URI change also changes
some hosts’ sandbox identity, so update any exact-origin allowlist when versioning it.

Test in the intended host before deploying: confirm OAuth approval, panel
entrypoints, mentions, context attachment, and removal. The local preview
verifies the bridge with test data; host installation and launcher behavior
require that host's integration setup.

### Stable plugin origin

For an OpenAI-hosted connector, configure `MCP_UI_DOMAIN` identically for the web
app's build and runtime (for example, `https://mcp-ui.haunter.app`). Haunter declares
this dedicated UI identity and automatically permits its exact sandbox origin.
Recreating the connector no longer requires copying its generated origin into the
allowlist on hosts that honor this metadata. No DNS record is needed. Use a separate
identity for a test plugin. Save pending changes and export unsynced recovery copies
before switching an existing plugin to the new identity, then refresh the connector
and reopen Haunter. Other hosts can still use explicit `MCP_EMBED_ALLOWED_ORIGINS`.
