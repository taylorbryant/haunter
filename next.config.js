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
	outputFileTracingIncludes: {
		"/changelog": ["./content/changelog/*.md"],
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
