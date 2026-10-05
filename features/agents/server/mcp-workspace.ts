import "@beignet/core/server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
	EmbeddedWorkspaceInputSchema,
	EmbeddedWorkspaceActionSchema,
	EmbeddedWorkspaceSchema,
	WorkspaceActionResultSchema,
} from "../mcp-app/workspace-schema";

export function registerMcpWorkspace(
	server: McpServer,
	input: {
		read(args: z.infer<typeof EmbeddedWorkspaceInputSchema>): Promise<unknown>;
		act(args: z.infer<typeof EmbeddedWorkspaceActionSchema>): Promise<unknown>;
		errorMessage(error: unknown): string;
	},
) {
	server.registerTool(
		"get_haunter_workspace",
		{
			title: "Browse Haunter workspace",
			description:
				"Read pages, standalone canvases, favorites and current embedded editing access.",
			inputSchema: EmbeddedWorkspaceInputSchema,
			outputSchema: EmbeddedWorkspaceSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["app"] } },
		},
		async (args) => {
			try {
				return {
					content: [],
					structuredContent: EmbeddedWorkspaceSchema.parse(
						await input.read(args),
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
		"act_in_haunter_workspace",
		{
			title: "Manage Haunter workspace content",
			description:
				"Perform an explicit embedded UI action with the connection's embedded editing consent and current workspace role.",
			inputSchema: EmbeddedWorkspaceActionSchema,
			outputSchema: WorkspaceActionResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["app"] } },
		},
		async (args) => {
			try {
				return {
					content: [],
					structuredContent: WorkspaceActionResultSchema.parse(
						await input.act(args),
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
}
