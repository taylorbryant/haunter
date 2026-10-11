Invite people into a workspace when you want to work together. Publish a page when someone only needs to read it. Use history and Trash to recover saved work, and pay attention to save status when your connection is interrupted.

## Collaborate in a workspace

In the web app, open the workspace switcher and choose **Members** to view its members. If your role allows member management, invite someone by email and choose their role.

Workspace roles determine who can view, edit, or manage members. People with editing access can work in the same page or canvas at the same time. You can see other participants while connected.

## Publish a read-only page

1. Open the page you want to share.
2. Open the page header's options menu and choose **Share**.
3. Choose **Publish**, then copy the public link.
4. Send that link to the people who should be able to read the page.

Anyone with the public link can view the page without a Haunter account. It shows the saved page, including supported inline canvases, in a read-only view. Later saved edits appear at the same link. Sharing one page does not grant access to the rest of the workspace.

Public links include a title-and-icon preview image for apps that display link previews. To stop sharing, return to **Share**, choose **Revoke link**, and confirm. You can publish a new link later.

## Export a page

Open the page header's options menu and choose **Export Markdown** or **Export HTML**.

- **Markdown** is useful for moving text into another editor. Some rich formatting and Haunter-specific content cannot be represented exactly.
- **HTML** creates a standalone page in your current Haunter theme for reading in a browser.

These exports are not full workspace backups. In particular, a Markdown export does not contain an editable canvas drawing. Keep the original page and canvas when you need to preserve their editing behavior.

## Restore a page version

1. Open the page and select its edited-time label in the header to open **History**.
2. Choose a saved version and review the preview.
3. Choose **Restore this version** if you want that content to replace the current page body.

Haunter saves the current content as a recovery version before restoring. Wait for your current edits to save first; a restore cannot continue if they have not synced.

Page history contains saved checkpoints, not a record of every keystroke. Restoring a page can also change its task blocks and page links. An inline canvas's placement belongs to page history, but its drawing has separate history.

## Restore a page from Trash

Open **Trash** in the sidebar, find the page, and choose **Restore**. Moving a parent page to Trash also moves its subpages; restoring the archived page tree brings its descendants back.

Choose **Delete forever** only when you want to permanently remove a page and its archived descendants. Permanent deletion cannot be undone through Trash or page history.

## Recover a canvas version

A connected assistant with **Full access** can inspect saved canvas versions and restore one. Ask it to show the available versions first, then identify the version you want. For example: “Show the saved versions of the checkout canvas before restoring anything.”

Canvas history is separate from page history. There is no canvas history picker in the current web or embedded UI. Restoring a canvas version replaces the saved drawing and keeps a recovery version of the current drawing. [Set up an AI connection](/help/ai) if you want to use this workflow.

## Recover work that has not synced

If the editor reports unsaved changes, reconnect and wait for confirmation that they have saved before closing it. **Saved in this browser** means the draft is stored locally, not that it has reached your other devices.

If Haunter offers a recovery download, save it before clearing browser data or signing out. To import a Haunter JSON recovery file, open the menu beside **Pages** and choose **Recover drafts**. The dialog creates new pages and canvases from the file and leaves existing work in place. For a Markdown recovery download, use **Import Markdown** in the web app instead.

Local drafts depend on that browser's storage. They are a fallback for interrupted saves, not a substitute for a confirmed save to Haunter.
