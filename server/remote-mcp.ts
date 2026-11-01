import { CanvasImageMetadataSchema } from "@/features/canvases/editing";
import "@beignet/core/server-only";
import { ReadAttachmentMetadataSchema } from "@/features/pages/attachments";
import {
	agentMcpMetadata,
	haunterMcpIcons,
} from "@/features/agents/server/mcp-metadata";
import { registerMcpWorkspace } from "@/features/agents/server/mcp-workspace";
import { registerMcpSettings } from "@/features/agents/server/mcp-settings";
import {
	readMcpSettingsUseCase,
	updateMcpSettingsUseCase,
} from "@/features/agents/use-cases/mcp-settings";
import {
	getEmbeddedWorkspaceUseCase,
	actInEmbeddedWorkspaceUseCase,
} from "@/features/agents/use-cases/embedded-workspace";
import { authorizeEmbeddedEditorUseCase } from "@/features/agents/use-cases/authorize-embedded-editor";
import { authorizeEmbeddedWorkspaceUseCase } from "@/features/agents/use-cases/authorize-embedded-workspace";
import { appError } from "@/features/shared/errors";
import { AgentCapabilityError } from "@beignet/core/agent-capabilities";
import { isAppError } from "@beignet/core/errors";
import { createZodSchemaConverter } from "@beignet/core/openapi";
import type { Implementation, McpServer } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import type { JWTPayload } from "jose";
import { createMcpHandler } from "mcp-handler";
import {
	createMcpAgentCapabilityAdapter,
	type McpAgentCapabilityTools,
} from "@beignet/mcp";
import { CanvasPreviewMetadataSchema } from "@/features/canvases/editing";
import { capabilitiesForAgentPermissionProfile } from "@/features/agents/permission-profiles";
import type { McpConnectionRow } from "@/features/agents/ports";
import { registerMcpCompanion } from "@/features/agents/server/mcp-companion";
import { registerMcpEditor } from "@/features/agents/server/mcp-editor";
import { env } from "@/lib/env";
import {
	agentCapabilities,
	agentCapabilityRegistry,
} from "@/lib/agent-capability-registry";
import {
	type AgentCapabilityServer,
	createHaunterAgentCapabilityExecutor,
	resolveRemoteMcpPrincipal,
	authorizeRemoteMcpCapability,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";

export const REMOTE_MCP_SCOPES = ["offline_access", "haunter:mcp"] as const;

const schemaConverter = createZodSchemaConverter();

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

function remoteMcpToolMetadata(
	name: (typeof agentCapabilities)[number]["name"],
) {
	const metadata = agentMcpMetadata(name);
	return {
		title: metadata.title,
		_meta: {
			...metadata._meta,
			...(["attach_file_to_page", "insert_canvas_image"].includes(name)
				? { "openai/fileParams": ["file"] }
				: {}),
		},
		annotations: {
			openWorldHint: ["attach_file_to_page", "insert_canvas_image"].includes(
				name,
			),
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
			].includes(name),
			destructiveHint: [
				"delete_canvas",
				"restore_page_version",
				"restore_canvas_version",
				"edit_canvas",
				"delete_canvas_shapes",
				"delete_task",
				"edit_page_blocks",
				"replace_page_content",
			].includes(name),
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
			].includes(name),
		},
	};
}

const remoteMcpTools = {
	...Object.fromEntries(
		agentCapabilities.map(({ name }) => [name, remoteMcpToolMetadata(name)]),
	),
	read_canvas_image: {
		...remoteMcpToolMetadata("read_canvas_image"),
		outputSchema: CanvasImageMetadataSchema,
		render({ data, ...metadata }) {
			return {
				content: [
					{ type: "text", text: JSON.stringify(metadata) },
					{ type: "image", mimeType: metadata.mimeType, data },
				],
				structuredContent: metadata,
			};
		},
	},
	preview_canvas: {
		...remoteMcpToolMetadata("preview_canvas"),
		outputSchema: CanvasPreviewMetadataSchema,
		render({ image, ...metadata }) {
			return {
				content: [
					{ type: "text", text: JSON.stringify(metadata) },
					{ type: "image", ...image },
				],
				structuredContent: metadata,
			};
		},
	},
	read_page_attachment: {
		...remoteMcpToolMetadata("read_page_attachment"),
		outputSchema: ReadAttachmentMetadataSchema,
		render({ text, data, ...metadata }) {
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
											mimeType: metadata.mimeType ?? "application/octet-stream",
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
		},
	},
} satisfies McpAgentCapabilityTools<typeof agentCapabilities>;

function remoteMcpErrorMessage(error: unknown) {
	// Let Beignet describe invalid arguments from the advertised input schema.
	if (error instanceof AgentCapabilityError && error.code === "invalid_input")
		return undefined;
	const cause =
		error instanceof AgentCapabilityError &&
		error.code === "execution_failed" &&
		error.cause
			? error.cause
			: error;
	if (
		isAppError(cause) &&
		["REVISION_CONFLICT", "CANVAS_REVISION_CONFLICT"].includes(cause.code)
	) {
		return JSON.stringify({
			code: cause.code,
			message: cause.message,
			currentRevision: resultRecord(cause.details)?.currentRevision,
		});
	}
	return safeToolErrorMessage(cause);
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
	registerMcpSettings(server, {
		read: async () =>
			readMcpSettingsUseCase.run({
				ctx: await (await input.getServer()).createServiceContext(),
				input: input.identity,
			}),
		update: async (appearance) =>
			updateMcpSettingsUseCase.run({
				ctx: await (await input.getServer()).createServiceContext(),
				input: { ...input.identity, appearance },
			}),
		errorMessage: safeToolErrorMessage,
	});
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
	createMcpAgentCapabilityAdapter({
		registry: agentCapabilityRegistry,
		schemaConverter: {
			...schemaConverter,
			toJSONSchema(schema, options) {
				// Preserve the dialect advertised to released CLI clients; the
				// shared converter omits it for embedding schemas in OpenAPI.
				return {
					...schemaConverter.toJSONSchema(schema, options),
					$schema: "https://json-schema.org/draft/2020-12/schema",
				};
			},
		},
		executor: () =>
			createHaunterAgentCapabilityExecutor({ getServer: input.getServer }),
		// Resolve current grants for every invocation, including on reused SDK servers.
		principal: () =>
			resolveRemoteMcpPrincipal(input.identity, { getServer: input.getServer }),
		authorize: authorizeRemoteMcpCapability,
		tools: remoteMcpTools,
		errorMessage: ({ error }) => remoteMcpErrorMessage(error),
	}).register({
		server,
		capabilities: agentCapabilities
			.filter(({ name }) => allowed.has(name))
			.map(({ name }) => name),
	});
}

export function createRemoteMcpRequestHandler(input: {
	connection: McpConnectionRow;
	identity: RemoteMcpIdentity;
	getServer: () => Promise<AgentCapabilityServer>;
}) {
	// mcp-handler forwards this to the SDK, but types only name and version.
	const serverInfo = {
		name: "haunter",
		title: "Haunter",
		description:
			"Organize notes, tasks, and canvases with Haunter and your agents.",
		websiteUrl: new URL(env.APP_URL).origin,
		icons: haunterMcpIcons,
		version: "1.0.0",
	} satisfies Implementation;
	return createMcpHandler((server) => registerRemoteMcpTools(server, input), {
		serverInfo,
		verboseLogs: false,
	});
}
