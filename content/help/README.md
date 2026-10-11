# Help content

These guides are published at `/help` without a session. Add or update Markdown
files here and register their title and description in `features/help/guides.ts`.
Use plain-text `##` headings for the table of contents and relative `/help/...`
links between guides. The page layout supplies the title, so do not add an H1.

Keep instructions tied to released UI labels and behavior. Call out differences
between the web app and embedded panel where they affect the reader's task.
Implementation and deployment documentation belongs in `docs/` instead.

Markdown is rendered on the server with raw HTML disabled. Content tests check
the published files, section anchors, and internal guide links. Run the normal
Beignet check and verify signed-out Help navigation after changing routes.
