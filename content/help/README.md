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

## Screenshots

Screenshots live in `public/guides/images/`. Capture the real web app with fictional
workspace content and the Dracula theme; keep account names and data synthetic.
Use a workspace overview for navigation and closer crops for individual controls.
Hide development tooling before capturing, and wait for saves, fonts, and canvas
animations to settle.

Save optimized WebP images at twice their intended desktop display size. Add a
standalone Markdown image with descriptive alt text and a quoted title for its
caption. Register its intrinsic pixel dimensions in
`features/help/components/help-markdown.tsx`; the renderer reserves that space,
loads the image lazily, and links to the full-size image. Update the image and
dimensions together when the pictured UI changes. Verify images and full-size
links while signed out, at phone and desktop widths.
