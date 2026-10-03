import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	ArrowRight,
	ChevronDown,
	ChevronRight,
	FileText,
	House,
	MessageSquare,
	PanelLeft,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GhostLogo } from "../components/ghost-logo";

/** Bundle a self-contained resource: no wrapper cookies, CDN, or direct API access. */
export async function buildMcpApp() {
	const directory = join(import.meta.dir, "../features/agents/mcp-app");
	const bundle = await Bun.build({
		entrypoints: [join(directory, "app.ts")],
		target: "browser",
		minify: true,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	if (!bundle.success)
		throw new AggregateError(bundle.logs, "Could not build the MCP companion.");
	const javascript = await bundle.outputs[0].text();
	const [template, styles, hostStyles, appStyles] = await Promise.all([
		readFile(join(directory, "index.html"), "utf8"),
		readFile(join(directory, "styles.css"), "utf8"),
		readFile(
			Bun.resolveSync("@openai/mcp-extensions/app/styles.css", import.meta.dir),
			"utf8",
		),
		readFile(join(directory, "../../../app/globals.css"), "utf8"),
	]);
	// Use the app's actual palette, so changes to Haunter's themes reach the iframe.
	const light = /:root\s*\{([^}]+)\}/.exec(appStyles)?.[1];
	const dark = /:root\.dark\s*\{([^}]+)\}/.exec(appStyles)?.[1];
	if (!light || !dark)
		throw new Error("Could not find Haunter's theme tokens.");
	const palette = `:root { ${light} } :root[data-theme="dark"] { ${dark} }`;
	const icons = {
		ghost: GhostLogo,
		"chevron-down": ChevronDown,
		"chevron-right": ChevronRight,
		search: Search,
		"arrow-right": ArrowRight,
		home: House,
		"panel-left": PanelLeft,
		refresh: RefreshCw,
		message: MessageSquare,
		close: X,
		page: FileText,
	};
	const html = template
		.replace(/<!-- icon:([a-z-]+) -->/g, (_, name: string) => {
			const icon = icons[name as keyof typeof icons];
			if (!icon) throw new Error(`Unknown companion icon: ${name}`);
			return renderToStaticMarkup(createElement(icon, { "aria-hidden": true }));
		})
		.replace(
			"<!-- styles -->",
			() => `<style>${hostStyles}\n${palette}\n${styles}</style>`,
		)
		.replace(
			"<!-- script -->",
			() =>
				`<script type="module">${javascript.replaceAll("</script", "<\\/script")}</script>`,
		);
	await mkdir(join(directory, "dist"), { recursive: true });
	await writeFile(join(directory, "dist/companion.html"), html);

	return html;
}

export const buildMcpEditorApp = buildMcpApp;

if (import.meta.main) {
	await buildMcpApp();
	console.log("Built Haunter MCP page companion.");
}
