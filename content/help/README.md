# Help content

These guides are published at `/guides` without a session. Add or update Markdown
files here and register their title and description in `features/help/guides.ts`.
Use plain-text `##` headings for the table of contents and relative `/guides/...`
links between guides. The page layout supplies the title, so do not add an H1.

Keep instructions tied to released UI labels and behavior. These guides cover
the web app and standard MCP connections for AI tools.
Implementation and deployment documentation belongs in `docs/` instead.

Markdown is rendered on the server with raw HTML disabled. Content tests check
the published files, section anchors, and internal guide links. Run the normal
Beignet check and verify signed-out Help navigation after changing routes.
