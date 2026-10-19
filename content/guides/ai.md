Connect Haunter to your AI app so your **AI agent** can find information, create content, and edit your work through conversation. The connection uses **MCP** (Model Context Protocol) and the access you approve.

## Connect Haunter

1. In Haunter, open your account menu and choose **Settings → Agents → Connect**.
2. Choose your AI app and the **Hosted** connection method.
3. Follow the displayed instructions to add Haunter to that app.
4. Sign in to Haunter when prompted.
5. Choose the workspaces the agent may access and an access level, then approve the connection.
6. Return to your AI app and ask your agent to find a page by name.

If your AI app asks for an MCP server URL, enter `https://www.haunter.app/mcp` and choose its OAuth sign-in option. Your app must support remote MCP connections and signing in through Haunter.

Some AI apps need the **Local bridge** option instead. Follow the instructions in the same connection dialog; the bridge runs on your computer and connects to hosted Haunter.

## Choose the right access

- **View only:** find and read pages, tasks, canvases, favorites, and history. Use this for questions and summaries.
- **View and edit:** also create and update content, add files and images, manage favorites, and complete or reopen tasks.
- **Full access:** also allows the agent to delete tasks and standalone canvases, move pages to Trash, replace all the content of a page, and restore older page or canvas versions.

Your workspace role still applies. A connection cannot give an agent more access than you have in that workspace.

The agent cannot delete your account, manage workspace members, permanently delete pages from Trash, or publish public links. You manage those actions yourself in Haunter.

## Open Haunter inside your AI app

If your AI app supports **MCP Apps**—interactive apps inside an AI conversation—ask your agent to open Haunter, a named page, or a canvas. The Haunter panel lets you browse Home and Tasks, write in pages, and draw alongside the conversation.

To edit in that panel, choose **View and edit** or **Full access** and enable **Allow editing in the embedded editor** when approving the connection. Your workspace role must also permit editing. Without this consent, the panel is read-only even when the agent has permission to make changes.

Wait for edits to save before closing the panel. If your AI app does not support the embedded workspace, open Haunter in your browser to review and continue the agent's work.

## Give your agent context

Name the page, canvas, or task you want to work on. Include the workspace name if you have similarly named items, or paste a Haunter link. Ask the agent to find and read the item before editing it.

For a specific passage, quote the text or name its heading: “In the Launch plan page, shorten the paragraph under Goals.” For a drawing, identify the canvas and the shapes by their labels: “In the Checkout flow canvas, group the Cart, Payment, and Confirmation steps.”

In the embedded workspace, select page text or canvas shapes before sending your next message. AI apps that support selection context let the agent use that selection to understand requests such as “Shorten this passage” or “Align these shapes.” Selecting something does not send a message or request an edit by itself.

You can also ask a connected agent to inspect your selection in an open Haunter browser tab. If you have several tabs or devices open, identify the page and workspace you mean. If the agent cannot find the selection, return to Haunter, select it again, or quote the text in your message.

Wait for your edits to save before asking the agent to change the same content.

## Requests to try

- “Create a project plan page with a summary and a table of milestones.”
- “Find the notes about onboarding in the Product workspace.”
- “Add a task to review the Launch plan page next Friday and assign it to me.”
- “Create a canvas showing the checkout flow in the Product workspace.”
- “Add the Launch plan and Meeting notes pages to my favorites.”
- “Show the saved versions of the Launch plan page before restoring anything.”

The agent's changes are saved in Haunter. Review the result in your browser or the Haunter panel before continuing.

## Follow activity in a canvas

When an agent works with an open canvas, an activity indicator shows its name, the member who connected it, and the action in progress. Newly created or updated shapes briefly receive a violet outline. Deletions and restored drawings show completion feedback without an outline.

If you see **Canvas action failed**, inspect the drawing before asking the agent to retry. The change may have saved before the connection was interrupted. You may not always see an activity indicator, so check the drawing to confirm the result.

## Manage or troubleshoot a connection

In the web app, open your account menu and choose **Settings → Agents** to review connected AI apps, their access, and recent activity, or disconnect an app.

If a workspace is missing, check that the connection was approved for it. If an edit is denied, check the connection's permission level and your workspace role. Reconnect through your AI app when it asks you to authorize again.
