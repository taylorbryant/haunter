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
		name: "list_pages",
		description:
			"List every active page in one workspace as lightweight metadata, including hierarchy. Call list_workspaces first to get a workspaceId.",
		input: {
			type: "object",
			required: ["workspaceId"],
			properties: {
				workspaceId: { type: "string" },
			},
		},
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
		name: "create_page",
		description:
			"Create a page in a workspace, optionally nested under another page and initialized from markdown. Call list_workspaces first to get a workspaceId.",
		input: {
			type: "object",
			required: ["workspaceId", "title"],
			properties: {
				workspaceId: { type: "string" },
				title: { type: "string", minLength: 1, maxLength: 300 },
				parentPageId: { type: "string", format: "uuid" },
				markdown: { type: "string", maxLength: 100_000 },
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
	{
		name: "list_tasks",
		description:
			"List tasks in one workspace. Defaults to open tasks assigned to the acting user; can include completed tasks, everyone's tasks, and a due-date cutoff.",
		input: {
			type: "object",
			required: ["workspaceId"],
			properties: {
				workspaceId: { type: "string" },
				filter: {
					type: "string",
					enum: ["open", "completed", "all"],
					default: "open",
				},
				scope: {
					type: "string",
					enum: ["mine", "everyone"],
					default: "mine",
				},
				dueOnOrBefore: {
					type: "string",
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
				},
				limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
			},
		},
	},
	{
		name: "create_task",
		description:
			"Create a standalone task in a workspace. The task is assigned to the acting user by default; dueDate uses YYYY-MM-DD.",
		input: {
			type: "object",
			required: ["workspaceId", "title"],
			properties: {
				workspaceId: { type: "string" },
				title: { type: "string", minLength: 1, maxLength: 300 },
				dueDate: {
					type: "string",
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
				},
				assigneeId: {
					anyOf: [{ type: "string" }, { type: "null" }],
				},
			},
		},
	},
	{
		name: "update_task",
		description:
			"Update a task's title, due date, or assignee. Set dueDate or assigneeId to null to clear it. Page-backed task titles must still be edited in their page.",
		input: {
			type: "object",
			required: ["workspaceId", "taskId"],
			properties: {
				workspaceId: { type: "string" },
				taskId: { type: "string", format: "uuid" },
				title: { type: "string", minLength: 1, maxLength: 300 },
				dueDate: {
					anyOf: [
						{
							type: "string",
							pattern: "^\\d{4}-\\d{2}-\\d{2}$",
						},
						{ type: "null" },
					],
				},
				assigneeId: {
					anyOf: [{ type: "string" }, { type: "null" }],
				},
			},
		},
	},
	{
		name: "complete_task",
		description:
			"Mark a task complete. For a page-backed task, the source task block is checked too.",
		input: {
			type: "object",
			required: ["workspaceId", "taskId"],
			properties: {
				workspaceId: { type: "string" },
				taskId: { type: "string", format: "uuid" },
			},
		},
	},
];

const DueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const WorkspaceScopedArgs = z.object({ workspaceId: z.string().min(1) });
const CreatePageArgs = WorkspaceScopedArgs.extend({
	title: z.string().trim().min(1).max(300),
	parentPageId: z.string().uuid().optional(),
	markdown: z.string().min(1).max(100_000).optional(),
});
const SearchArgs = WorkspaceScopedArgs.extend({
	query: z.string().min(1).max(200),
});
const ReadPageArgs = WorkspaceScopedArgs.extend({ pageId: z.string().uuid() });
const AppendArgs = ReadPageArgs.extend({
	markdown: z.string().min(1).max(100_000),
});
const ListTasksArgs = WorkspaceScopedArgs.extend({
	filter: z.enum(["open", "completed", "all"]).default("open"),
	scope: z.enum(["mine", "everyone"]).default("mine"),
	dueOnOrBefore: DueDate.optional(),
	limit: z.number().int().min(1).max(200).default(50),
});
const CreateTaskArgs = WorkspaceScopedArgs.extend({
	title: z.string().trim().min(1).max(300),
	dueDate: DueDate.optional(),
	assigneeId: z.string().nullable().optional(),
});
const UpdateTaskArgs = WorkspaceScopedArgs.extend({
	taskId: z.string().uuid(),
	title: z.string().trim().min(1).max(300).optional(),
	dueDate: DueDate.nullable().optional(),
	assigneeId: z.string().nullable().optional(),
}).refine(
	(input) =>
		input.title !== undefined ||
		input.dueDate !== undefined ||
		input.assigneeId !== undefined,
	{ message: "Provide a title, dueDate, or assigneeId to update." },
);
const CompleteTaskArgs = WorkspaceScopedArgs.extend({
	taskId: z.string().uuid(),
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

type AgentCapabilityDependencies = {
	getServer?: () => Promise<AppServer>;
};

export async function executeAgentCapability(
	{ capability, arguments: args, agentSession }: ExecuteInput,
	dependencies: AgentCapabilityDependencies = {},
): Promise<unknown> {
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

	const server = dependencies.getServer
		? await dependencies.getServer()
		: await import("@/server").then(({ getServer }) => getServer());

	switch (capability) {
		case "list_pages": {
			const input = WorkspaceScopedArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { listPagesUseCase } = await import("@/features/pages/use-cases");
			const result = await listPagesUseCase.run({
				ctx,
				input: { workspaceId: input.workspaceId },
			});
			return {
				pages: result.items.map((page) => ({
					pageId: page.id,
					title: page.title,
					icon: page.icon,
					parentPageId: page.parentPageId,
					updatedAt: page.updatedAt,
				})),
			};
		}
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
		case "create_page": {
			const input = CreatePageArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const initialContent = input.markdown
				? await import("@/features/pages/lib/markdown").then(
						({ markdownToBlocks }) => markdownToBlocks(input.markdown ?? ""),
					)
				: null;
			if (initialContent && initialContent.length === 0) {
				throw new APIError("BAD_REQUEST", {
					message: "The markdown produced no page content.",
				});
			}
			const { createPageUseCase, savePageContentUseCase } = await import(
				"@/features/pages/use-cases"
			);
			const page = await createPageUseCase.run({
				ctx,
				input: {
					workspaceId: input.workspaceId,
					title: input.title,
					...(input.parentPageId ? { parentPageId: input.parentPageId } : {}),
				},
			});

			let updatedAt = page.updatedAt;
			if (initialContent) {
				const saved = await savePageContentUseCase.run({
					ctx,
					input: {
						id: page.id,
						content: initialContent,
						baseUpdatedAt: page.updatedAt,
					},
				});
				updatedAt = saved.updatedAt;
			}

			return {
				pageId: page.id,
				title: page.title,
				parentPageId: page.parentPageId,
				updatedAt,
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
		case "list_tasks": {
			const input = ListTasksArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { listTasksUseCase } = await import("@/features/tasks/use-cases");
			const result = await listTasksUseCase.run({
				ctx,
				input: {
					workspaceId: input.workspaceId,
					filter: input.filter,
					scope: input.scope,
					limit: input.limit,
					...(input.dueOnOrBefore
						? { dueOnOrBefore: input.dueOnOrBefore }
						: {}),
				},
			});
			return {
				tasks: result.items.map((task) => ({
					taskId: task.id,
					title: task.title,
					completed: task.completed,
					dueDate: task.dueDate,
					assigneeId: task.assigneeId,
					assigneeName: task.assigneeName,
					pageId: task.pageId,
					pageTitle: task.pageTitle,
					completedAt: task.completedAt,
					updatedAt: task.updatedAt,
				})),
				hasMore: result.hasMore,
			};
		}
		case "create_task": {
			const input = CreateTaskArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { createTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await createTaskUseCase.run({
				ctx,
				input: {
					workspaceId: input.workspaceId,
					title: input.title,
					...(input.dueDate ? { dueDate: input.dueDate } : {}),
					...(input.assigneeId !== undefined
						? { assigneeId: input.assigneeId }
						: {}),
				},
			});
			return {
				taskId: task.id,
				title: task.title,
				completed: task.completed,
				dueDate: task.dueDate,
				assigneeId: task.assigneeId,
				createdAt: task.createdAt,
				updatedAt: task.updatedAt,
			};
		}
		case "update_task": {
			const input = UpdateTaskArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { updateTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await updateTaskUseCase.run({
				ctx,
				input: {
					id: input.taskId,
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
					...(input.assigneeId !== undefined
						? { assigneeId: input.assigneeId }
						: {}),
				},
			});
			return {
				taskId: task.id,
				title: task.title,
				completed: task.completed,
				dueDate: task.dueDate,
				assigneeId: task.assigneeId,
				updatedAt: task.updatedAt,
			};
		}
		case "complete_task": {
			const input = CompleteTaskArgs.parse(args);
			const ctx = await createAgentContext(server, userId, input.workspaceId);
			const { updateTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await updateTaskUseCase.run({
				ctx,
				input: { id: input.taskId, completed: true },
			});
			return {
				taskId: task.id,
				title: task.title,
				completed: task.completed,
				completedAt: task.completedAt,
				updatedAt: task.updatedAt,
			};
		}
		default:
			throw new APIError("BAD_REQUEST", {
				message: `Unknown capability: ${capability}`,
			});
	}
}
