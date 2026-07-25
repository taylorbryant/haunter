# Haunter changelog

Release notes are source-controlled so they can be reviewed with the code they
describe.

To publish a release:

1. Add a Markdown file named after the version, using the same frontmatter and
   `##` sections shown in `0.1.0.md`.
2. Add the release to the beginning of `features/changelog/releases.ts`.
3. Keep every section as a list of concise, user-facing changes.

The first manifest entry drives the in-app unread indicator. The parser rejects
frontmatter that differs from the manifest so the public page and unread state
cannot silently drift apart.
