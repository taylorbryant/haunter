import {
	CanvasImageOutputSchema,
	CanvasImageMetadataSchema,
} from "@/features/canvases/editing";
import "@beignet/core/server-only";
import {
	ReadAttachmentMetadataSchema,
	ReadAttachmentOutputSchema,
} from "@/features/pages/attachments";
import { registerMcpWorkspace } from "@/features/agents/server/mcp-workspace";
import {
	getEmbeddedWorkspaceUseCase,
	actInEmbeddedWorkspaceUseCase,
} from "@/features/agents/use-cases/embedded-workspace";
import { authorizeEmbeddedEditorUseCase } from "@/features/agents/use-cases/authorize-embedded-editor";
import { authorizeEmbeddedWorkspaceUseCase } from "@/features/agents/use-cases/authorize-embedded-workspace";
import { appError } from "@/features/shared/errors";
import { AgentCapabilityError } from "@beignet/core/agent-capabilities";
import { isAppError } from "@beignet/core/errors";
import type { McpServer } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import type { JWTPayload } from "jose";
import { createMcpHandler } from "mcp-handler";
import type { ZodType } from "zod";
import {
	CanvasPreviewMetadataSchema,
	CanvasPreviewOutputSchema,
} from "@/features/canvases/editing";
import { capabilitiesForAgentPermissionProfile } from "@/features/agents/permission-profiles";
import type { McpConnectionRow } from "@/features/agents/ports";
import { registerMcpCompanion } from "@/features/agents/server/mcp-companion";
import { registerMcpEditor } from "@/features/agents/server/mcp-editor";
import { env } from "@/lib/env";
import { agentCapabilities } from "@/lib/agent-capability-registry";
import {
	type AgentCapabilityServer,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";

export const REMOTE_MCP_SCOPES = ["offline_access", "haunter:mcp"] as const;

export type RemoteMcpIdentity = {
	userId: string;
	clientId: string;
};

export function remoteMcpIdentityFromJwt(
	jwt: JWTPayload,
): RemoteMcpIdentity | null {
	const clientId =
		typeof jwt.client_id === "string"
			? jwt.client_id
			: typeof jwt.azp === "string"
				? jwt.azp
				: null;
	if (typeof jwt.sub !== "string" || !clientId) return null;
	const scopes =
		typeof jwt.scope === "string"
			? new Set(jwt.scope.split(/\s+/).filter(Boolean))
			: new Set<string>();
	if (!scopes.has("haunter:mcp")) return null;
	return { userId: jwt.sub, clientId };
}

export function allowedRemoteMcpCapabilities(
	connection: Pick<McpConnectionRow, "permissionProfile">,
) {
	return new Set<string>(
		capabilitiesForAgentPermissionProfile(connection.permissionProfile),
	);
}

function resultRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeToolErrorMessage(error: unknown) {
	if (isAppError(error) || error instanceof APIError) return error.message;
	if (error instanceof AgentCapabilityError) {
		if (error.code === "invalid_input") {
			return "The tool arguments are invalid.";
		}
		if (error.code === "unknown_capability") {
			return "This tool is not available.";
		}
	}
	return "Haunter could not complete this action.";
}

export function registerRemoteMcpTools(
	server: McpServer,
	input: {
		connection: McpConnectionRow;
		identity: RemoteMcpIdentity;
		getServer: () => Promise<AgentCapabilityServer>;
	},
) {
	const allowed = allowedRemoteMcpCapabilities(input.connection);
	if (
		["list_workspaces", "list_pages", "search_pages", "read_page"].every(
			(name) => allowed.has(name),
		)
	) {
		const workspaceContext = async (workspaceId: string) => {
			const runtime = await input.getServer();
			const role = await runtime.ports.members.findRole(
				workspaceId,
				input.identity.userId,
			);
			if (!role) throw appError("Forbidden");
			return runtime.createServiceContext({
				tenantId: workspaceId,
				asUser: { id: input.identity.userId, role },
			});
		};
		registerMcpWorkspace(server, {
			read: async (args) =>
				getEmbeddedWorkspaceUseCase.run({
					ctx: await workspaceContext(args.workspaceId),
					input: { ...args, clientId: input.identity.clientId },
				}),
			act: async (args) =>
				actInEmbeddedWorkspaceUseCase.run({
					ctx: await workspaceContext(args.workspaceId),
					input: { ...args, clientId: input.identity.clientId },
				}),
			errorMessage: safeToolErrorMessage,
		});
		registerMcpEditor(server, {
			appOrigin: env.APP_URL,
			authorizeWorkspace: async (args) =>
				authorizeEmbeddedWorkspaceUseCase.run({
					ctx: await workspaceContext(args.workspaceId),
					input: { ...args, clientId: input.identity.clientId },
				}),
			authorize: async (args) => {
				const runtime = await input.getServer();
				const role = await runtime.ports.members.findRole(
					args.workspaceId,
					input.identity.userId,
				);
				if (!role) throw appError("Forbidden");
				const ctx = await runtime.createServiceContext({
					tenantId: args.workspaceId,
					asUser: { id: input.identity.userId, role },
				});
				return authorizeEmbeddedEditorUseCase.run({
					ctx,
					input: {
						...args,
						clientId: input.identity.clientId,
					},
				});
			},
			execute: (capability, args) =>
				executeRemoteMcpCapability(
					{ capability, arguments: args, ...input.identity },
					{ getServer: input.getServer },
				),
			errorMessage: safeToolErrorMessage,
		});
		registerMcpCompanion(server, {
			appOrigin: env.APP_URL,
			uiDomain: env.MCP_UI_DOMAIN,
			execute: (capability, args) =>
				executeRemoteMcpCapability(
					{
						capability,
						arguments: args,
						...input.identity,
					},
					{ getServer: input.getServer },
				),
			errorMessage: safeToolErrorMessage,
		});
	}
	for (const capability of agentCapabilities) {
		if (!allowed.has(capability.name)) continue;
		server.registerTool(
			capability.name,
			{
				description: capability.description,
				inputSchema: capability.input as ZodType,
				...(["attach_file_to_page", "insert_canvas_image"].includes(
					capability.name,
				)
					? { _meta: { "openai/fileParams": ["file"] } }
					: {}),
				outputSchema:
					capability.name === "read_canvas_image"
						? CanvasImageMetadataSchema
						: capability.name === "preview_canvas"
							? CanvasPreviewMetadataSchema
							: capability.name === "read_page_attachment"
								? ReadAttachmentMetadataSchema
								: (capability.output as ZodType),
				annotations: {
					openWorldHint: [
						"attach_file_to_page",
						"insert_canvas_image",
					].includes(capability.name),
					readOnlyHint: [
						"list_canvases",
						"list_canvas_favorites",
						"list_page_favorites",
						"list_backlinks",
						"list_trash",
						"list_page_versions",
						"read_page_version",
						"list_active_sessions",
						"get_active_context",
						"preview_canvas",
						"search_canvas_library",
						"read_canvas",
						"read_canvas_image",
						"list_workspaces",
						"list_workspace_members",
						"list_pages",
						"search_pages",
						"search_workspace",
						"read_page",
						"list_page_attachments",
						"read_page_attachment",
						"list_tasks",
					].includes(capability.name),
					destructiveHint: [
						"delete_canvas",
						"restore_page_version",
						"restore_canvas_version",
						"edit_canvas",
						"delete_canvas_shapes",
						"delete_task",
						"edit_page_blocks",
						"replace_page_content",
					].includes(capability.name),
					idempotentHint: [
						"list_canvases",
						"list_canvas_favorites",
						"list_page_favorites",
						"list_backlinks",
						"list_trash",
						"list_page_versions",
						"read_page_version",
						"update_canvas",
						"set_canvas_favorite",
						"set_page_favorite",
						"list_active_sessions",
						"get_active_context",
						"preview_canvas",
						"search_canvas_library",
						"read_canvas",
						"read_canvas_image",
						"list_workspaces",
						"list_workspace_members",
						"list_pages",
						"search_pages",
						"search_workspace",
						"read_page",
						"list_page_attachments",
						"read_page_attachment",
						"list_tasks",
					].includes(capability.name),
				},
			},
			async (args: unknown) => {
				try {
					const argumentsRecord = resultRecord(args) ?? {};
					const result = await executeRemoteMcpCapability(
						{
							capability: capability.name,
							arguments: argumentsRecord,
							userId: input.identity.userId,
							clientId: input.identity.clientId,
						},
						{ getServer: input.getServer },
					);
					if (capability.name === "read_canvas_image") {
						const { data, ...metadata } = CanvasImageOutputSchema.parse(result);
						return {
							content: [
								{ type: "text" as const, text: JSON.stringify(metadata) },
								{ type: "image" as const, mimeType: metadata.mimeType, data },
							],
							structuredContent: metadata,
						};
					}
					if (capability.name === "read_page_attachment") {
						const { text, data, ...metadata } =
							ReadAttachmentOutputSchema.parse(result);
						const uri = `haunter://pages/${metadata.pageId}/attachments/${encodeURIComponent(metadata.blockId)}`;
						const contents =
							text !== undefined
								? [
										{
											type: "resource" as const,
											resource: {
												uri,
												mimeType: metadata.mimeType ?? "text/plain",
												text,
											},
										},
									]
								: data && metadata.mimeType?.startsWith("image/")
									? [
											{
												type: "image" as const,
												mimeType: metadata.mimeType,
												data,
											},
										]
									: data
										? [
												{
													type: "resource" as const,
													resource: {
														uri,
														mimeType:
															metadata.mimeType ?? "application/octet-stream",
														blob: data,
													},
												},
											]
										: [];
						return {
							content: [
								{ type: "text" as const, text: JSON.stringify(metadata) },
								...contents,
							],
							structuredContent: metadata,
						};
					}
					if (capability.name === "preview_canvas") {
						const { image, ...metadata } =
							CanvasPreviewOutputSchema.parse(result);
						return {
							content: [
								{ type: "text" as const, text: JSON.stringify(metadata) },
								{ type: "image" as const, ...image },
							],
							structuredContent: metadata,
						};
					}
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result, null, 2),
							},
						],
						...(resultRecord(result)
							? { structuredContent: resultRecord(result) }
							: {}),
					};
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text:
									isAppError(error) &&
									["REVISION_CONFLICT", "CANVAS_REVISION_CONFLICT"].includes(
										error.code,
									)
										? JSON.stringify({
												code: error.code,
												message: error.message,
												currentRevision: resultRecord(error.details)
													?.currentRevision,
											})
										: safeToolErrorMessage(error),
							},
						],
					};
				}
			},
		);
	}
}

export function createRemoteMcpRequestHandler(input: {
	connection: McpConnectionRow;
	identity: RemoteMcpIdentity;
	getServer: () => Promise<AgentCapabilityServer>;
}) {
	return createMcpHandler((server) => registerRemoteMcpTools(server, input), {
		serverInfo: {
			name: "haunter",
			version: "1.0.0",
		},
		verboseLogs: false,
	});
}
