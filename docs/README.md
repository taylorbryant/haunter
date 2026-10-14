# Maintainer documentation

These references cover developing, operating, and debugging Haunter. MCP
references document the contracts and client behavior to preserve when changing
the tools. Start with [Contributing to Haunter](../CONTRIBUTING.md) for local setup
and validation, and [AGENTS.md](../AGENTS.md) for coding-agent conventions.

User guides are published at [haunter.app/guides](https://www.haunter.app/guides).
Their source lives in [content/guides](../content/guides/README.md); keep instructions
for using the hosted app there. Published release notes live in
[content/changelog](../content/changelog/README.md). The README in each content
directory is an authoring reference for maintainers and is not published.

| Topic | Reference |
| --- | --- |
| Operating hosted Haunter | [Production operations](deployment.md) |
| Collaborative editing | [Worker operation, persistence, and recovery](collaboration.md) |
| Workspace access | [Membership authorization](membership-authorization.md) |
| MCP tools | [Pages](mcp-page-editing.md), [canvases](mcp-canvas-editing.md), [files](mcp-files.md), [content management](mcp-content-management.md), [search](workspace-search.md) |
| Agent context and feedback | [Live context](mcp-live-context.md), [canvas activity](mcp-canvas-activity.md) |
| Embedded editor | [MCP App integration](mcp-app.md) |
| UI maintenance | [Keyboard focus](keyboard-focus.md), [editor benchmarks](editor-benchmarks.md) |
| Dependency patches | [Editor patches and upgrade checks](../patches/README.md) |
| Writing product documentation | [Guide authoring](../content/guides/README.md), [changelog authoring](../content/changelog/README.md) |
