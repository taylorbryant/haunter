import "@beignet/core/server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	COMPANION_URI,
	CompanionPageSchema,
	MAX_MENTION_RESULTS,
	PAGE_RESOURCE_TEMPLATE,
	PageListSchema,
	parsePageResourceUri,
	pageResourceUri,
	WorkspaceListSchema,
} from "@/features/agents/mcp-app/schemas";

type CompanionExecution = {
	appOrigin: string;
	execute(
		capability: "list_workspaces" | "list_pages" | "search_pages" | "read_page",
		args: Record<string, unknown>,
	): Promise<unknown>;
	errorMessage(error: unknown): string;
};

const readOnlyAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

export function registerMcpCompanion(
	server: McpServer,
	input: CompanionExecution,
) {
	server.registerResource(
		"haunter-page-companion",
		COMPANION_URI,
		{ title: "Haunter", mimeType: "text/html;profile=mcp-app" },
		async () => ({
			contents: [
				{
					uri: COMPANION_URI,
					mimeType: "text/html;profile=mcp-app",
					text: await readFile(
						join(process.cwd(), "features/agents/mcp-app/dist/companion.html"),
						"utf8",
					),
					_meta: {
						ui: {
							csp: {
								connectDomains: [],
								resourceDomains: [],
								frameDomains: [new URL(input.appOrigin).origin],
							},
							prefersBorder: true,
						},
						"openai/widgetCSP": {
							redirect_domains: [new URL(input.appOrigin).origin],
						},
						"openai/ui": {
							preferredDisplayMode: "fullscreen",
							availableDisplayModes: ["inline", "fullscreen"],
						},
					},
				},
			],
		}),
	);

	server.registerTool(
		"open_haunter",
		{
			title: "Haunter",
			description:
				"Open Haunter to browse, search, and use its page editor. Editing follows the connection's explicit consent and current workspace permissions. Pages and selections can be added to this conversation.",
			inputSchema: z.object({}),
			outputSchema: WorkspaceListSchema,
			annotations: readOnlyAnnotations,
			_meta: {
				ui: { resourceUri: COMPANION_URI, visibility: ["app", "model"] },
				"openai/outputTemplate": COMPANION_URI,
				"openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
			},
		},
		async () => {
			try {
				return {
					content: [],
					structuredContent: WorkspaceListSchema.parse(
						await input.execute("list_workspaces", {}),
					),
				};
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text", text: input.errorMessage(error) }],
				};
			}
		},
	);

	server.registerTool(
		"search_mentions",
		{
			title: "Search Haunter page mentions",
			description: "Find pages in currently authorized Haunter workspaces.",
			inputSchema: z.object({ query: z.string().max(200) }),
			annotations: readOnlyAnnotations,
			_meta: {
				"openai/extensions": { "mentions/search": {} },
				ui: { visibility: ["app"] },
			},
		},
		async ({ query }) => {
			try {
				// Re-resolve connection scope and current membership on every search.
				const { workspaces } = WorkspaceListSchema.parse(
					await input.execute("list_workspaces", {}),
				);
				const items = [];
				const trimmed = query.trim();
				// Serial reads keep a large connection from creating unbounded fan-out.
				for (const workspace of workspaces) {
					const { pages } = PageListSchema.parse(
						await input.execute(
							trimmed.length >= 2 ? "search_pages" : "list_pages",
							{
								workspaceId: workspace.id,
								...(trimmed.length >= 2 ? { query: trimmed } : {}),
							},
						),
					);
					for (const page of pages) {
						if (
							trimmed.length === 1 &&
							!page.title
								.toLocaleLowerCase()
								.includes(trimmed.toLocaleLowerCase())
						)
							continue;
						items.push({
							type: "resource_link" as const,
							uri: pageResourceUri(workspace.id, page.pageId),
							name: page.title || "Untitled page",
							title: page.title || "Untitled page",
							description: workspace.name,
							mimeType: "text/markdown",
						});
						if (items.length === MAX_MENTION_RESULTS) break;
					}
					if (items.length === MAX_MENTION_RESULTS) break;
				}
				return { content: [], structuredContent: { items } };
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text", text: input.errorMessage(error) }],
				};
			}
		},
	);

	server.registerResource(
		"haunter-page",
		new ResourceTemplate(PAGE_RESOURCE_TEMPLATE, { list: undefined }),
		{ title: "Haunter page", mimeType: "text/markdown" },
		async (uri) => {
			try {
				const args = parsePageResourceUri(uri.href);
				// The capability executor rechecks revocation, workspace scope, and role.
				const page = CompanionPageSchema.parse(
					await input.execute("read_page", { ...args, format: "markdown" }),
				);
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/markdown",
							text: `# ${page.title}\n\n${page.markdown}`,
							_meta: {
								"haunter/page": {
									revision: page.revision,
									updatedAt: page.updatedAt,
								},
							},
						},
					],
				};
			} catch (error) {
				throw new Error(input.errorMessage(error));
			}
		},
	);
}
