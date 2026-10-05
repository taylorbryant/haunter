import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
	const template = await readFile(join(directory, "host.html"), "utf8");
	const html = template.replace(
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
