import "@beignet/core/server-only";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { AppContext, AppRuntimePorts } from "@/app-context";
import type { getServer } from "@/server";

type AppServer = Awaited<ReturnType<typeof getServer>>;

/**
 * Agent Auth Protocol capabilities: what a delegated AI agent may do in
 * Haunter on a user's behalf. Execution goes through the same gate-authorized
 * use cases as human requests — an agent context is built from the acting
 * user's *verified* membership row, so an agent can never see or touch a
 * workspace its user couldn't. Everything the plugin needs at module-init
 * time is pure data; the executor dynamically imports the server so this
 * file can be imported from lib/better-auth.ts without a module cycle.
 */

export const agentCapabilities = [
	{
		name: "list_workspaces",
		description:
			"List the workspaces the acting user belongs to, with their role in each. Call this first to get workspaceId values for the other capabilities.",
		input: { type: "object", properties: {} },
	},
	{
		name: "search_pages",
		description:
			"Full-text search across the pages of one workspace. Returns page ids and titles.",
		input: {
			type: "object",
			required: ["workspaceId", "query"],
			properties: {
				workspaceId: { type: "string" },
				query: { type: "string", maxLength: 200 },
			},
		},
	},
	{
		name: "read_page",
		description: "Read a page as markdown.",
		input: {
			type: "object",
			required: ["workspaceId", "pageId"],
			properties: {
				workspaceId: { type: "string" },
				pageId: { type: "string", format: "uuid" },
			},
		},
	},
	{
		name: "append_to_page",
		description:
			"Append markdown content to the end of a page. Supports headings, paragraphs, bullet/numbered lists, task items (- [ ] title, optionally with a '(due: YYYY-MM-DD)' suffix), code fences, blockquotes (rendered as callouts), and dividers.",
		input: {
			type: "object",
			required: ["workspaceId", "pageId", "markdown"],
			properties: {
				workspaceId: { type: "string" },
				pageId: { type: "string", format: "uuid" },
				markdown: { type: "string", maxLength: 100_000 },
			},
		},
	},
];

const WorkspaceScopedArgs = z.object({ workspaceId: z.string().min(1) });
const SearchArgs = WorkspaceScopedArgs.extend({
	query: z.string().min(1).max(200),
});
const ReadPageArgs = WorkspaceScopedArgs.extend({ pageId: z.string().uuid() });
const AppendArgs = ReadPageArgs.extend({
	markdown: z.string().min(1).max(100_000),
});

/**
 * Build an AppContext for an agent acting as `userId` inside `workspaceId`.
 * Membership is re-resolved from the database — the role is never taken from
 * the agent's claims — so gate policies (tenant match, viewer read-only)
 * apply to agents exactly as they do to signed-in members. Context assembly
 * itself goes through `server.createServiceContext` (the framework owns
 * requestId, trace, and gate attachment); the app's `asUser` service input
 * carries the verified identity (see server/context.ts).
 */
async function createAgentContext(
	server: AppServer,
	userId: string,
	workspaceId: string,
): Promise<AppContext> {
	const ports = server.ports as AppRuntimePorts;
	const role = await ports.members.findRole(workspaceId, userId);
	if (!role) {
		// APIError so the plugin surfaces a 403 instead of a generic 500.
		throw new APIError("FORBIDDEN", {
			message: "The acting user is not a member of this workspace.",
		});
	}

	return server.createServiceContext({
		asUser: { id: userId, role },
		tenantId: workspaceId,
	});
}

type ExecuteInput = {
	capability: string;
	arguments?: Record<string, unknown>;
	agentSession: { userId: string | null };
};

export async function executeAgentCapability({
	capability,
	arguments: args,
	agentSession,
}: ExecuteInput): Promise<unknown> {
	const userId = agentSession.userId;
	if (!userId) {
		throw new APIError("FORBIDDEN", {
			message: "This capability requires a delegated agent acting for a user.",
		});
	}

	if (capability === "list_workspaces") {
		const { auth } = await import("@/lib/better-auth");
		const authContext = await auth.$context;
		const memberships = await authContext.adapter.findMany<{
			organizationId: string;
			role: string;
		}>({
			model: "member",
			where: [{ field: "userId", value: userId }],
		});
		const workspaces = await Promise.all(
			memberships.map(async (membership) => {
				const organization = await authContext.adapter.findOne<{
					id: string;
					name: string;
				}>({
					model: "organization",
					where: [{ field: "id", value: membership.organizationId }],
				});
				return {
					id: membership.organizationId,
					name: organization?.name ?? "",
					role: membership.role,
				};
			}),
		);
		return { workspaces };
	}

	const { getServer } = await import("@/server");
	const server = await getServer();

	switch (capability) {
		case "search_pages": {
			const input = SearchArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { searchPagesUseCase } = await import("@/features/pages/use-cases");
			const result = await searchPagesUseCase.run({
				ctx,
				input: { q: input.query },
			});
			return {
				pages: result.items.map((item) => ({
					pageId: item.id,
					title: item.title,
				})),
			};
		}
		case "read_page": {
			const input = ReadPageArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { getPageUseCase } = await import("@/features/pages/use-cases");
			const { blocksToMarkdown } = await import(
				"@/features/pages/lib/markdown"
			);
			const page = await getPageUseCase.run({
				ctx,
				input: { id: input.pageId },
			});
			return {
				pageId: page.id,
				title: page.title,
				markdown: blocksToMarkdown(page.content),
				updatedAt: page.updatedAt,
			};
		}
		case "append_to_page": {
			const input = AppendArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { getPageUseCase, savePageContentUseCase } = await import(
				"@/features/pages/use-cases"
			);
			const { markdownToBlocks } = await import(
				"@/features/pages/lib/markdown"
			);
			const page = await getPageUseCase.run({
				ctx,
				input: { id: input.pageId },
			});
			const appended = markdownToBlocks(input.markdown);
			if (appended.length === 0) {
				throw new APIError("BAD_REQUEST", {
					message: "The markdown produced no content to append.",
				});
			}
			// baseUpdatedAt makes this a CAS write: a concurrent human edit wins
			// and the agent gets a stale-write error instead of clobbering it.
			const saved = await savePageContentUseCase.run({
				ctx,
				input: {
					id: input.pageId,
					content: [...page.content, ...appended],
					baseUpdatedAt: page.updatedAt,
				},
			});
			return { appendedBlocks: appended.length, updatedAt: saved.updatedAt };
		}
		default:
			throw new APIError("BAD_REQUEST", {
				message: `Unknown capability: ${capability}`,
			});
	}
}
