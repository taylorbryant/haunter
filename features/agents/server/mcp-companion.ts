import "@beignet/core/server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { parseMcpUiDomain } from "../mcp-ui-domain.js";
import {
	OpenHaunterInputSchema,
	OpenHaunterOutputSchema,
} from "../mcp-app/workspace-opener";
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
	uiDomain?: string;
	execute(
		capability:
			| "list_workspaces"
			| "list_pages"
			| "search_pages"
			| "read_page"
			| "list_tasks",
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
	const uiIdentity =
		input.uiDomain === undefined ? undefined : parseMcpUiDomain(input.uiDomain);
	server.registerResource(
		"haunter-page-companion",
		COMPANION_URI,
		{ title: "Haunter", mimeType: "text/html;profile=mcp-app" },
		async () => ({
			contents: [
				{
					uri: COMPANION_URI,
					mimeType: "text/html;profile=mcp-app",
					text: (
						await readFile(
							join(
								process.cwd(),
								"features/agents/mcp-app/dist/companion.html",
							),
							"utf8",
						)
					).replaceAll(
						"__HAUNTER_APP_ORIGIN__",
						new URL(input.appOrigin).origin
							.replaceAll("&", "&amp;")
							.replaceAll('"', "&quot;"),
					),
					_meta: {
						ui: {
							...(uiIdentity ? { domain: uiIdentity.domain } : {}),
							permissions: { clipboardWrite: {} },
							csp: {
								connectDomains: [],
								resourceDomains: [],
								frameDomains: [new URL(input.appOrigin).origin],
							},
							prefersBorder: true,
						},
						...(uiIdentity ? { "openai/widgetDomain": uiIdentity.domain } : {}),
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
				"Open Haunter's Home or Tasks screen. Pass view=tasks with optional filter/scope, or workspaceId and taskId to focus a known task (including completed tasks). Find task IDs with list_tasks. This only navigates; editing follows the connection's explicit consent and workspace permissions. Current tasks and selections become conversation context automatically.",
			inputSchema: OpenHaunterInputSchema,
			outputSchema: OpenHaunterOutputSchema,
			annotations: readOnlyAnnotations,
			_meta: {
				ui: { resourceUri: COMPANION_URI, visibility: ["app", "model"] },
				"openai/outputTemplate": COMPANION_URI,
				"openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
			},
		},
		async (args) => {
			try {
				const list = WorkspaceListSchema.parse(
					await input.execute("list_workspaces", {}),
				);
				const workspaceId = args.workspaceId ?? list.workspaces[0]?.id;
				if (
					args.workspaceId &&
					!list.workspaces.some((item) => item.id === args.workspaceId)
				)
					throw appError("Forbidden");
				if (args.taskId) {
					const result = z
						.object({ tasks: z.array(z.object({ taskId: z.uuid() })) })
						.parse(
							await input.execute("list_tasks", {
								workspaceId,
								taskId: args.taskId,
								filter: "all",
								scope: "everyone",
								limit: 1,
							}),
						);
					if (!result.tasks.some((task) => task.taskId === args.taskId))
						throw appError("TaskNotFound");
				}
				const tasks =
					args.view === "tasks" || !!(args.taskId || args.filter || args.scope);
				return {
					content: [],
					structuredContent: {
						...list,
						...(workspaceId
							? {
									target: {
										workspaceId,
										view: tasks ? ("tasks" as const) : ("home" as const),
										...(tasks
											? {
													filter: args.taskId ? ("all" as const) : args.filter,
													scope: args.taskId
														? ("everyone" as const)
														: args.scope,
													taskId: args.taskId,
												}
											: {}),
									},
								}
							: {}),
					},
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
