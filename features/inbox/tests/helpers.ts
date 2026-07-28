import { tenantScopeId } from "@beignet/core/ports";
import type {
	InboxItemRecord,
	InboxRepository,
	NewInboxItem,
} from "@/features/inbox/ports";
import type { PageRepository } from "@/features/pages/ports";
import type { TaskRepository } from "@/features/tasks/ports";

export function createTestInboxRepository(deps: {
	pages: PageRepository;
	tasks: TaskRepository;
}): InboxRepository {
	const items = new Map<string, InboxItemRecord>();
	let sequence = 0;

	return {
		async listForUser(scope, userId, options) {
			const workspaceId = tenantScopeId(scope);
			const matches = Array.from(items.values())
				.filter(
					(item) => item.workspaceId === workspaceId && item.userId === userId,
				)
				.sort(
					(left, right) =>
						right.createdAt.localeCompare(left.createdAt) ||
						right.id.localeCompare(left.id),
				);

			const resolved = await Promise.all(
				matches.map(async (item) => {
					if (item.kind === "page" && item.pageId) {
						const page = await deps.pages.findMetaById(scope, item.pageId);
						return page && page.deletedAt === null
							? {
									id: item.id,
									workspaceId,
									kind: "page" as const,
									page,
									task: null,
									createdAt: item.createdAt,
								}
							: null;
					}
					if (item.kind === "task" && item.taskId) {
						const task = await deps.tasks.findById(scope, item.taskId);
						return task && !task.completed
							? {
									id: item.id,
									workspaceId,
									kind: "task" as const,
									page: null,
									task,
									createdAt: item.createdAt,
								}
							: null;
					}
					return null;
				}),
			);

			const available = resolved
				.filter((item) => item !== null)
				.filter(
					(item) =>
						!options.cursor ||
						item.createdAt < options.cursor.createdAt ||
						(item.createdAt === options.cursor.createdAt &&
							item.id < options.cursor.id),
				);
			const page = available.slice(0, options.limit);
			const last = page.at(-1);
			return {
				items: page,
				nextCursor:
					available.length > options.limit && last
						? { createdAt: last.createdAt, id: last.id }
						: null,
			};
		},
		async findForUser(scope, userId, id) {
			const item = items.get(id);
			return item?.workspaceId === tenantScopeId(scope) &&
				item.userId === userId
				? item
				: null;
		},
		async create(scope, input: NewInboxItem) {
			sequence += 1;
			const item: InboxItemRecord = {
				id: crypto.randomUUID(),
				workspaceId: tenantScopeId(scope),
				createdAt: new Date(Date.now() + sequence).toISOString(),
				...input,
			};
			items.set(item.id, item);
			return item;
		},
		async deleteForUser(scope, userId, id) {
			const item = items.get(id);
			if (
				item?.workspaceId === tenantScopeId(scope) &&
				item.userId === userId
			) {
				items.delete(id);
			}
		},
		async deleteByPageIds(scope, pageIds) {
			const workspaceId = tenantScopeId(scope);
			const ids = new Set(pageIds);
			for (const item of items.values()) {
				if (
					item.workspaceId === workspaceId &&
					item.pageId &&
					ids.has(item.pageId)
				) {
					items.delete(item.id);
				}
			}
		},
		async deleteByTaskIds(scope, taskIds) {
			const workspaceId = tenantScopeId(scope);
			const ids = new Set(taskIds);
			for (const item of items.values()) {
				if (
					item.workspaceId === workspaceId &&
					item.taskId &&
					ids.has(item.taskId)
				) {
					items.delete(item.id);
				}
			}
		},
	};
}
