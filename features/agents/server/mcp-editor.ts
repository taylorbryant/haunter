import "@beignet/core/server-only";
import { EmbeddedEditorAuthorizationSchema } from "@/features/agents/embedded-editor-session";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	EDITOR_URI,
	EditorInputSchema,
	EditorOutputSchema,
	editorPaths,
} from "@/features/agents/mcp-app/editor-schema";
import { CompanionPageSchema } from "@/features/agents/mcp-app/schemas";

export function registerMcpEditor(
	server: McpServer,
	input: {
		appOrigin: string;
		execute(
			capability: "read_page",
			args: Record<string, unknown>,
		): Promise<unknown>;
		authorize?(args: {
			workspaceId: string;
			pageId: string;
			challenge: string;
		}): Promise<{ id: string }>;
		errorMessage(error: unknown): string;
	},
) {
	const origin = new URL(input.appOrigin).origin;
	if (input.authorize)
		server.registerTool(
			"authorize_haunter_editor",
			{
				title: "Authorize the embedded Haunter editor",
				description:
					"Bind a short-lived page session to the embedded editor's proof challenge.",
				inputSchema: EmbeddedEditorAuthorizationSchema,
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false,
				},
				_meta: { ui: { visibility: ["app"] } },
			},
			async (args) => {
				try {
					const handoff = await input.authorize?.(args);
					// This ID is not a credential. Only the iframe holding the verifier can redeem it.
					return { content: [], structuredContent: handoff };
				} catch (error) {
					return {
						isError: true,
						content: [{ type: "text", text: input.errorMessage(error) }],
					};
				}
			},
		);

	server.registerTool(
		"open_haunter_editor",
		{
			title: "Open Haunter's real editor",
			description:
				"Open a specific Haunter page in the actual web editor. Use list_workspaces and list_pages or search_pages to find its IDs first. The editor uses this approved Haunter connection and current workspace permissions. Embedded editing requires explicit consent; otherwise it is read-only. This tool only opens the interface and does not edit the page.",
			inputSchema: EditorInputSchema,
			outputSchema: EditorOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: EDITOR_URI, visibility: ["app", "model"] },
				"openai/outputTemplate": EDITOR_URI,
			},
		},
		async ({ workspaceId, pageId }) => {
			try {
				const page = CompanionPageSchema.parse(
					await input.execute("read_page", {
						workspaceId,
						pageId,
						format: "markdown",
					}),
				);
				const paths = editorPaths(workspaceId, pageId);
				return {
					content: [
						{
							type: "text",
							text: `Open “${page.title || "Untitled page"}” in Haunter's real editor.`,
						},
					],
					structuredContent: EditorOutputSchema.parse({
						workspaceId,
						pageId,
						title: page.title,
						editorUrl: new URL(paths.editorPath, origin).href,
						webUrl: new URL(paths.webPath, origin).href,
					}),
				};
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text", text: input.errorMessage(error) }],
				};
			}
		},
	);
}
