# Haunter CLI

Capture notes, find pages, and manage tasks in [Haunter](https://www.haunter.app)
from your terminal. Requires Node.js 22 or later and a Haunter account.

This README includes the upcoming 0.2.0 release. Workspace search, canvas
listing, page renaming, task updating/reopening, and the `tools` commands require
0.2.0. The published 0.1.0 release supports the original page, capture, and task
commands.

## Get started

Install the CLI and sign in:

```bash
npm install -g haunter
haunter login
haunter workspaces list
haunter workspaces use WORKSPACE_ID
```

Your browser opens Haunter's sign-in and consent screen. Choose the workspaces
and permissions the CLI can use. Replace `WORKSPACE_ID` with an ID from the list.
If you approve exactly one workspace, commands use it automatically.

You can also run commands without a global install using `npx haunter --help`.

## Capture notes

Create a page from quoted text, a Markdown file, or piped input:

```bash
haunter capture "An idea for later"
haunter capture --file meeting.md --title "Meeting notes"
cat meeting.md | haunter capture --title "Meeting notes"
```

Without `--title`, the first nonempty line becomes the title, up to 120
characters. Each command prints the page title and ID. Input is limited to
100,000 characters.

To add content to an existing page, use `--page`. To create a child page, use
`--parent`. Replace `PAGE_ID` with the page's ID:

```bash
haunter capture "Another thought" --page PAGE_ID
haunter capture --file notes.md --parent PAGE_ID --title "Follow-up"
```

Appending preserves existing content. `--page` cannot be combined with `--title`
or `--parent`.

## Find and read pages

```bash
haunter pages list
haunter pages search "meeting notes"
haunter pages read PAGE_ID
```

Lists show page IDs and titles. Reading a page prints its Markdown. Quote search
phrases and task titles containing spaces.

Rename a page without changing its content or location:

```bash
haunter pages rename PAGE_ID "Updated meeting notes"
```

Page titles can contain up to 300 characters.

## Search your workspace and list canvases

Search across pages, tasks, and canvases in your selected workspace:

```bash
haunter search "meeting notes"
haunter search "meeting" --kind task
haunter canvases list
```

Search queries must contain 2–200 characters. Search returns up to 20 matches
per request; use `--limit 1..50` to change that or `--kind all|page|task|canvas`
to filter the type. Each result shows its type, ID, title, and matching excerpt.

When more results are available, the CLI prints a next cursor on stderr.
Repeat the same query and `--kind` with `--cursor NEXT_CURSOR` to continue.
With `--json`, the cursor is in the `nextCursor` field of the result.

`canvases list` shows IDs and titles of standalone canvases. Canvases embedded
inside pages are not included.

## Manage tasks

```bash
haunter tasks list
haunter tasks list --due today
haunter tasks add "Review proposal" --due 2026-12-12
haunter tasks done TASK_ID
haunter tasks reopen TASK_ID
haunter tasks update TASK_ID --title "Review revised proposal" --due 2026-12-13
haunter tasks update TASK_ID --clear-due
```

Task lists default to your open tasks, with a limit of 50. Use
`--filter open|completed|all`, `--scope mine|everyone`,
`--due today|overdue|upcoming`, and `--limit 1..200` to change the selection.
Creating and completing tasks prints the task ID.

`tasks reopen` marks a completed task as open. `tasks update` changes only the
fields you supply. Use `--title` to rename a standalone task, `--due YYYY-MM-DD`
to set its due date, or `--clear-due` to remove its date, time, and reminder.
`--due` and `--clear-due` cannot be combined. To rename a task inside a page,
edit its title in that page. Task titles can contain up to 1,000 characters.

## Discover and call more tools

In 0.2.0, discover tools available to your signed-in connection, including new
tools that don't have a dedicated CLI command:

```bash
haunter tools list
haunter tools describe search_workspace
haunter tools call search_workspace --input search.json --json
```

Create `search.json` with the arguments shown by `tools describe`:

```json
{"query":"meeting notes"}
```

The CLI checks the current tool list and argument schema each time you call a
tool. New tools become available as the server adds them, within your approved
permissions. Run `haunter login` again if you need different access. Tools
reserved for embedded app interfaces are omitted. Tools requiring background
MCP tasks are not supported.

`--input` accepts a JSON file, or `-` for piped input. It must contain one JSON
object, up to 1,000,000 bytes. Without `--input`, arguments start as `{}`:

```bash
printf '%s' '{"query":"meeting notes"}' | haunter tools call search_workspace --input - --json
haunter tools call list_workspaces --json
```

For tools with a `workspaceId` argument, the CLI fills it from `--workspace`,
`HAUNTER_WORKSPACE`, the saved selection, or the only approved workspace.
A `workspaceId` supplied in JSON takes precedence over saved or environment
defaults; a conflicting `--workspace` is an error. Tools without that argument
don't use a default workspace and reject `--workspace`.

`tools describe` and `tools call` print JSON, formatted for reading unless
`--json` is set. Calls preserve the complete MCP result: `content`,
`structuredContent`, and any metadata. Image data and resource links stay in
the JSON; the CLI does not render or download them. A tool error also preserves
the result on stdout, reports an error on stderr, and exits with code 1. Check
the exit code before treating a result as successful.

## Use the CLI in scripts

Add `--json` to get one JSON value on stdout:

```bash
haunter pages search "meeting" --json
haunter tasks list --filter all --json
haunter capture "An idea for later" --json
```

Errors go to stderr as `{"error":"…"}` in JSON mode. Successful commands exit
with code 0, errors with 1, and cancellation with 130. Sign-in instructions go to
stderr, including when `login --json` is used.

Commands use saved credentials and refresh them when needed. Only `login` opens
a browser. If a write times out, check Haunter before repeating it: the change
may have been saved.

## Choose a workspace or server

Pass `--workspace WORKSPACE_ID` (or `-w WORKSPACE_ID`) to a search, canvas, page,
capture, task, or workspace-scoped `tools call` command to override the saved
workspace.

| Setting | Flag | Environment variable | Default |
| --- | --- | --- | --- |
| Workspace | `--workspace` | `HAUNTER_WORKSPACE` | Saved selection, or the only approved workspace |
| Server | `--server` | `HAUNTER_SERVER` | `https://www.haunter.app/mcp` |
| Configuration directory | — | `HAUNTER_CONFIG_DIR` | `$XDG_CONFIG_HOME/haunter` or `~/.config/haunter`; `%APPDATA%\haunter` on Windows |

Flags take precedence over environment variables. Credentials and workspace
selections are separate for each server. A bare server origin gets `/mcp`
appended. HTTPS is required except for local development:

```bash
haunter login --server http://localhost:3000
haunter pages list --server http://localhost:3000
```

## Sign-in and troubleshooting

- Run `haunter status` to see whether credentials are saved and which workspace
  is selected. This checks local settings, not whether the session is still valid.
- Run `haunter login` again if a session is revoked or you need different access.
  Choose permissions that allow creating pages or managing tasks to use those commands.
- Use `haunter login --no-browser` to open the printed URL yourself. Complete
  sign-in in a browser on the same computer as the CLI; the callback uses
  `127.0.0.1`. Sign-in times out after five minutes.
- If the callback port is busy, use `haunter login --port 43822`. The default is
  43821; a chosen port is remembered for that server.
- Commands for the same server run one at a time to protect token refresh.
  If a process is forcibly terminated, verify that it has stopped before removing
  the `.lock` file named in the error.

Credentials are stored locally in a file with owner-only permissions on Unix.
Treat the configuration directory as sensitive. `haunter logout` removes local
tokens. To revoke access on the server, disconnect **Haunter CLI** in
**Haunter → Settings → Agents**.

Run `haunter --help` for the complete command list.

## License

MIT. See [LICENSE](LICENSE).
