# Developing and releasing the CLI

The `haunter` npm package lives in `packages/cli`. It uses Haunter's hosted MCP
tools and OAuth consent flow; it does not import server code or require app
environment variables. User instructions live in the [CLI README](../packages/cli/README.md).

## Validate a change

Use Bun 1.4.2 for development and Node.js 22 or later to verify the distributed
executable. The CLI has its own manifest and lockfile; the root app stays private.

```bash
cd packages/cli
bun install --frozen-lockfile
bun run check
bun run verify:package
```

`check` type-checks, tests against a disposable local OAuth/MCP server, and builds
`dist/index.js`. `verify:package` packs the build, installs it into a temporary
directory through npm, checks the file allowlist, and runs the Node executable
against that server. It needs npm registry access to install dependencies but
does not access a real Haunter account. CI runs it on Node 22 and 24.

Run `bun beignet check` and the changed app maps from the repository root before
handoff. Install dependencies in `packages/cli` first so the root type check and
test discovery can resolve the package's dependencies.

## Preserve released CLI compatibility

The `tools list`, `tools describe`, and `tools call` commands discover the
permission-scoped MCP tool schemas at runtime. They need no command mapping
for new tools. Friendly commands such as `capture` still have explicit
argument/output mappings and require compatibility with installed releases.

Two checks guard those contracts:

- `features/agents/tests/cli-compatibility.test.ts` compares the real MCP
  `tools/list` response with the checked-in `cli-contract-0.1.0.json` baseline
  and exercises the current CLI against the production handler with disposable
  SQLite data. Additive tools and properties are allowed. Removed tools/fields,
  newly required input, weakened output guarantees, and changes to constraints
  or defaults fail for review. This is a conservative schema check, not a proof
  that every possible old request remains compatible.
- `bun run verify:cli-compatibility` downloads the exact published `haunter@0.1.0`
  tarball, verifies its pinned SHA-512 integrity, installs it in a temporary
  directory, and runs its Node executable against the current MCP handler.
  CI runs this on Node 22 and 24. The flow covers all nine tools used by 0.1.0,
  including page append, child pages, task completion, and workspace denial.
  It requires npm access and uses no production account. OAuth is covered by
  separate CLI tests; this fixture supplies authentication at the handler boundary.

Keep released contract fixtures immutable. The initial fixture records the
server schemas at merged commit `739d72007bce57a3fe7d66b49e97b37ae5c499c1` and
the published package integrity. A failing check should lead to preserving the
old contract (for example, through an adapter or a separate tool name), not
regenerating the baseline from the changed server. Any intentional retirement
needs an explicit support/migration decision.

When publishing another supported release, retain existing baselines and add
its pinned tarball and contract coverage to the compatibility suite. Do not
replace the pinned version with `latest`. Schema checks alone cannot detect
semantic changes; expand the real-handler flow when a new command adds behavior.

## Publish a release

`haunter@0.1.0` is published. This branch prepares 0.2.0; merging does not
publish it. Releases must increment `packages/cli/package.json#version`.
Before publishing 0.2.0, remove the upcoming-release notice in its README.

From `packages/cli`, after validation:

```bash
npm whoami --registry=https://registry.npmjs.org
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org
npm view haunter version
npx --yes haunter@0.2.0 --version
```

Sign in with `npm login` if needed and complete any npm two-factor prompt.
`prepack` runs the package check and build before packaging or publishing.
Verify that the tarball contains only `dist/index.js`, `package.json`,
`README.md`, and `LICENSE`. Never publish from the private application root.

The MIT license applies to `packages/cli`. Publishing does not change the license
of the surrounding application.
