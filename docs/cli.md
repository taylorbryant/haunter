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

## Publish a release

The initial target is `haunter@0.1.0`. The package name is not reserved until a
publish succeeds. Check availability before the first publish. Subsequent
releases must increment `packages/cli/package.json#version`.

From `packages/cli`, after validation:

```bash
npm whoami --registry=https://registry.npmjs.org
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org
npm view haunter version
npx --yes haunter@0.1.0 --version
```

Sign in with `npm login` if needed and complete any npm two-factor prompt.
`prepack` runs the package check and build before packaging or publishing.
Verify that the tarball contains only `dist/index.js`, `package.json`,
`README.md`, and `LICENSE`. Never publish from the private application root.

The MIT license applies to `packages/cli`. Publishing does not change the license
of the surrounding application.
