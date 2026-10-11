Connect Haunter to an AI client to find information, create content, and edit your work through conversation. Clients that support **MCP Apps** can also show an interactive Haunter panel beside the chat. MCP is the protocol the client uses to talk to Haunter.

## Connect Haunter

1. In your AI client's app or integration settings, add Haunter. If the client asks for an MCP server URL, use `https://haunter.app/mcp` and its OAuth sign-in option.
2. Sign in to Haunter when prompted.
3. Choose the workspaces this connection may access and a permission level.
4. If you want to edit directly in an embedded Haunter panel, enable **Allow editing in the embedded editor** when approving an editing connection.
5. Return to the client and ask it to open Haunter or find a page by name.

Custom connection setup and interactive panels depend on the client and your plan. A client can support Haunter's tools without supporting the embedded UI. For a self-hosted Haunter installation, use your installation's address followed by `/mcp`.

## Choose the right access

- **View only:** find and read pages, tasks, canvases, favorites, and history. Use this for questions and summaries.
- **View and edit:** also create and update content, add files and images, manage favorites, and complete or reopen tasks.
- **Full access:** also permits destructive actions, including deleting tasks and standalone canvases, archiving pages, replacing page bodies, and restoring older page or canvas versions.

Your workspace role still applies. A connection cannot give an assistant more access than you have in that workspace.

The embedded editing option is separate from the assistant's tool permissions. With it enabled, your actions in the panel can include removing content or moving pages to Trash. With it disabled, the panel stays read-only even if the assistant can edit through its tools.

Account deletion, workspace membership management, permanent page deletion from Trash, and publishing public links stay under your control in Haunter.

## Give your assistant context

In a client that supports context updates, opening a page or canvas in the panel makes its identity available to the assistant. Selecting a passage or canvas shapes gives it a more specific target for your next request. Clicking or focusing a task shares that task's context too.

Try selecting a paragraph and asking, “Rewrite this to be shorter.” On a canvas, select several shapes and ask, “Group these and give the group a name.” You do not need to press a separate “Use as context” button.

Context updates do not send a message or start a response. The assistant can read saved content when it needs more detail; opening a page does not automatically attach the whole document. Selected text can include unsaved edits, so wait for saving to finish when asking it to change the saved page.

If the client does not provide this context, name the page, canvas, or task in your request. Include the workspace name when it could be ambiguous.

## Requests to try

- “Create a project plan page with a summary and a table of milestones.”
- “Find the notes about onboarding in this workspace.”
- “Add a task to review this draft next Friday and assign it to me.”
- “Create a canvas showing the checkout flow and open it.”
- “Add these pages to my favorites.”
- “Show the saved versions of this page before restoring anything.”

Changes made through the connection affect the same Haunter content you see on the web. Review the result in the page, task list, or drawing. Live updates normally appear without a manual refresh while the panel is connected.

## Manage or troubleshoot a connection

In the web app, open your account menu and choose **Settings → Agents** to review connected clients, their access, and recent activity, or disconnect a client.

If a workspace is missing, check that the connection was approved for it. If the panel is read-only, check its embedded editing consent and your workspace role. Reconnect through the client when the panel asks you to authorize again.

For a shortcut conflict, use the sidebar Search button or **Cmd+Shift+K** on Mac and **Ctrl+Shift+K** on Windows and Linux. Choose **Appearance** at the bottom of the panel's sidebar to set a Haunter theme; **Follow host** follows light or dark mode rather than a named host theme.
