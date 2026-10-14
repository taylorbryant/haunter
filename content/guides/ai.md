Connect Haunter to an AI client to find information, create content, and edit your work through conversation. The connection uses **MCP** (Model Context Protocol), which lets your assistant call Haunter's tools with the access you approve.

## Connect Haunter

1. In your AI client's app or integration settings, add Haunter. If the client asks for an MCP server URL, use `https://www.haunter.app/mcp` and its OAuth sign-in option.
2. Sign in to Haunter when prompted.
3. Choose the workspaces this connection may access and a permission level.
4. Return to the client and ask it to find a page by name.

Choose a client that supports remote MCP servers and OAuth. Connection setup and availability depend on the client and your plan.

For client-specific setup instructions, open **Settings → Agents → Connect** in Haunter and choose your client. The **Local bridge** option runs on the computer running your AI client and connects to hosted Haunter when the client needs Agent Auth compatibility.

## Choose the right access

- **View only:** find and read pages, tasks, canvases, favorites, and history. Use this for questions and summaries.
- **View and edit:** also create and update content, add files and images, manage favorites, and complete or reopen tasks.
- **Full access:** also permits destructive actions, including deleting tasks and standalone canvases, archiving pages, replacing page bodies, and restoring older page or canvas versions.

Your workspace role still applies. A connection cannot give an assistant more access than you have in that workspace.

Account deletion, workspace membership management, permanent page deletion from Trash, and publishing public links stay under your control in Haunter.

## Open Haunter inside your AI client

If your client supports **MCP Apps**, ask your assistant to open Haunter, a named page, or a canvas. Haunter opens beside the conversation so you can browse Home and Tasks, write in pages, and draw while working with your assistant.

To edit in that panel, choose **View and edit** or **Full access** and enable **Allow editing in the embedded editor** when approving the connection. Your workspace role must also permit editing. Without this consent, the panel is read-only even when the assistant has permission to make changes.

Wait for edits to save before closing the panel. If your client does not support the embedded workspace, open Haunter in your browser to review and continue the assistant's work.

## Give your assistant context

Name the page, canvas, or task you want to work on. Include the workspace name when it could be ambiguous, or paste a Haunter link. Ask the assistant to find and read the item before editing it.

For a specific passage, quote the text or name its heading: “In the Launch plan page, shorten the paragraph under Goals.” For a drawing, identify the canvas and the shapes by their labels: “In the Checkout flow canvas, group the Cart, Payment, and Confirmation steps.”

In the embedded workspace, select page text or canvas shapes before sending your next message. Clients that support selection context can use that selection to understand requests such as “Shorten this passage” or “Align these shapes.” Selecting something does not send a message or request an edit by itself.

You can also ask a connected assistant to inspect your selection in an open Haunter browser tab. If you have several tabs or devices open, identify the page and workspace you mean. If the assistant cannot find the selection, return to Haunter, select it again, or quote the text in your message.

Wait for your edits to save before asking the assistant to change the same content.

## Requests to try

- “Create a project plan page with a summary and a table of milestones.”
- “Find the notes about onboarding in the Product workspace.”
- “Add a task to review the Launch plan page next Friday and assign it to me.”
- “Create a canvas showing the checkout flow in the Product workspace.”
- “Add the Launch plan and Meeting notes pages to my favorites.”
- “Show the saved versions of the Launch plan page before restoring anything.”

Changes made through MCP are saved in Haunter. Open the page, task list, or canvas in the web app to review the result and continue editing.

## Follow activity in a canvas

When an assistant works with an open canvas, an activity indicator shows the agent's name, the member who connected it, and the action in progress. After a successful edit, created or updated shapes briefly receive a violet outline. Deleted shapes and restored drawings show completion feedback without an outline.

If you see **Canvas action failed**, inspect the drawing before asking the assistant to retry. The change may have saved even if the connection was interrupted before confirmation arrived. Canvas tools can also work when activity feedback is unavailable, so an absent indicator does not mean the operation failed.

## Manage or troubleshoot a connection

In the web app, open your account menu and choose **Settings → Agents** to review connected clients, their access, and recent activity, or disconnect a client.

If a workspace is missing, check that the connection was approved for it. If an edit is denied, check the connection's permission level and your workspace role. Reconnect through the client when it asks you to authorize again.
