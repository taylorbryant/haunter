import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEmbeddedEditorOrigin } from "./features/agents/embedded-editor-origin.js";
import { parseMcpUiDomain } from "./features/agents/mcp-ui-domain.js";

// Next traces Node's export conditions, but Vercel runs these modules with Bun.
// lib0 selects additional logging/crypto modules for Bun. Resolve Yjs's own
// version: BlockNote also installs an incompatible lib0 prerelease.
const yjsRequire = createRequire(import.meta.resolve("yjs"));
const yjsLib0Directory = relative(
	dirname(fileURLToPath(import.meta.url)),
	dirname(yjsRequire.resolve("lib0/package.json")),
).replaceAll("\\", "/");

// Bun installs Tiptap's peer-dependency contexts at distinct physical paths.
// Turbopack otherwise treats each path as a separate module, which gives
// ProseMirror multiple class identities and breaks editing when a Node from one
// copy reaches Fragment.from in another. Force the stateful editor runtime
// through one top-level copy.
const editorSingletonPackages = [
	"@tiptap/core",
	"@tiptap/extensions",
	"@tiptap/pm",
	"@tiptap/react",
	"prosemirror-changeset",
	"prosemirror-commands",
	"prosemirror-dropcursor",
	"prosemirror-gapcursor",
	"prosemirror-highlight",
	"prosemirror-history",
	"prosemirror-inputrules",
	"prosemirror-keymap",
	"prosemirror-model",
	"prosemirror-schema-list",
	"prosemirror-state",
	"prosemirror-tables",
	"prosemirror-transform",
	"prosemirror-view",
];

/** @type {import("next").NextConfig} */
const nextConfig = {
	async headers() {
		const origins = new Set([
			new URL(process.env.APP_URL ?? "http://localhost:3000").origin,
			"https://chatgpt.com",
			"https://web-sandbox.oaiusercontent.com",
		]);
		if (process.env.MCP_UI_DOMAIN !== undefined)
			origins.add(parseMcpUiDomain(process.env.MCP_UI_DOMAIN).sandboxOrigin);
		for (const value of process.env.MCP_EMBED_ALLOWED_ORIGINS?.split(",") ??
			[]) {
			const origin = value.trim();
			if (!origin) continue;
			if (!isEmbeddedEditorOrigin(origin))
				throw new Error(
					"MCP_EMBED_ALLOWED_ORIGINS must contain exact HTTP(S) or Codex MCP App origins.",
				);
			origins.add(origin);
		}
		return [
			{
				source: "/embed/:path*",
				headers: [
					{
						key: "Content-Security-Policy",
						value: `frame-ancestors 'self' ${[...origins].join(" ")}`,
					},
					{ key: "Referrer-Policy", value: "no-referrer" },
				],
			},
		];
	},
	// Route handlers and SSR use separate Turbopack module runtimes. Keep their
	// editor schemas/state on native modules so constructor checks stay valid.
	serverExternalPackages: [
		"yjs",
		"@tldraw/tlschema",
		"@tldraw/state",
		"@tldraw/store",
		"@tldraw/utils",
		"@tldraw/validate",
	],
	outputFileTracingIncludes: {
		"/*": [`${yjsLib0Directory}/**/*.{js,mjs,cjs,json}`],
		"/changelog": ["./content/changelog/*.md"],
		"/mcp": ["./features/agents/mcp-app/dist/companion.html"],
	},
	turbopack: {
		resolveAlias: {
			...Object.fromEntries(
				editorSingletonPackages.map((packageName) => [
					packageName,
					`./node_modules/${packageName}`,
				]),
			),
			// Tiptap 3.27.1 accidentally bundles its own ProseMirror runtime into
			// this extension's dist file. Use the equivalent local shim, which
			// imports the singleton runtime above instead.
			"@tiptap/extension-blockquote":
				"./features/canvases/client/tiptap-blockquote.ts",
		},
	},
};

export default nextConfig;
