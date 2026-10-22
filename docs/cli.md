# Developing and releasing the CLI

The `haunter` npm package lives in `packages/cli`. It uses Haunter's hosted MCP
tools and OAuth consent flow; it does not import server code or require app
environment variables. User instructions live in the [CLI README](../packages/cli/README.md).

## Validate a change

Use Bun 1.4.4 for development and Node.js 22 or later to verify the distributed
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
test discovery can resolve the package's dependencies. The root suite includes
`features/agents/tests/cli-oauth-registration.test.ts`, which verifies the CLI's
native loopback registration through Haunter's request guard and the installed
Better Auth OAuth provider.

## Preserve released CLI compatibility

The `tools list`, `tools describe`, and `tools call` commands discover the
permission-scoped MCP tool schemas at runtime. They need no command mapping
for new tools. Friendly commands such as `capture` still have explicit
argument/output mappings and require compatibility with installed releases.

Two checks guard those contracts:

- `features/agents/tests/cli-compatibility.test.ts` compares the real MCP
  `tools/list` response with the immutable `cli-contract-0.1.0.json` and
  `cli-contract-0.2.0.json` baselines and exercises the current CLI against the
  production handler with disposable SQLite data. Additive tools and properties are allowed. Removed tools/fields,
  newly required input, weakened output guarantees, and changes to constraints
  or defaults fail for review. This is a conservative schema check, not a proof
  that every possible old request remains compatible.
  Current-CLI tests also cover workspace search pagination, standalone canvas
  listing, page renaming, task updates/reopening, and view-only permissions.
- `bun run verify:cli-compatibility` downloads the exact published `haunter@0.1.0`
  and `haunter@0.2.0` tarballs, verifies each pinned SHA-512 integrity, and installs
  each release in its own temporary directory. It runs the Node executables
  against the current MCP handler with fresh disposable data for each flow.
  CI runs both releases on Node 22 and 24. Both exercise the original page, task,
  and workspace commands; 0.2.0 also exercises workspace search and pagination,
  canvas listing, page renaming, task updates/reopening, tool discovery and
  validation, and view-only permissions.
  It requires npm access and uses no production account. OAuth is covered by
  separate CLI tests; this fixture supplies authentication at the handler boundary.

Keep released contract fixtures immutable. Each fixture records the original
merged source commit, the schemas used by that release’s friendly commands, and
the published package integrity. A failing check should lead to preserving the
old contract (for example, through an adapter or a separate tool name), not
regenerating the baseline from the changed server. Any intentional retirement
needs an explicit support/migration decision.

When publishing another supported release, retain existing baselines and add
its original contract fixture to `cliBaselines` in
`features/agents/tests/cli-baselines.ts`, then extend the published-package flow
in `scripts/verify-cli-compatibility.ts` for any new commands. Do not
replace the pinned version with `latest`. Schema checks alone cannot detect
semantic changes; expand the real-handler flow when a new command adds behavior.

## Publish a release

Increment `packages/cli/package.json#version` for each release, then validate
the package. From `packages/cli`, publish and verify that exact version:

```bash
HAUNTER_RELEASE_VERSION=$(node -p "require('./package.json').version")
npm whoami --registry=https://registry.npmjs.org
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org
npm view "haunter@$HAUNTER_RELEASE_VERSION" version --registry=https://registry.npmjs.org
npx --yes "haunter@$HAUNTER_RELEASE_VERSION" --version
```

Sign in with `npm login` if needed and complete any npm two-factor prompt.
`prepack` runs the package check and build before packaging or publishing.
Verify that the tarball contains only `dist/index.js`, `package.json`,
`README.md`, and `LICENSE`. Never publish from the private application root.

The MIT license applies to `packages/cli`. Publishing does not change the license
of the surrounding application.
