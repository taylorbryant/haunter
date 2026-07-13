import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import type { MemberRepository } from "@/features/members/ports";
import type { TaskRepository } from "@/features/tasks/ports";
import { extractTaskBlocks } from "./extract-task-blocks";

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type TaskReconciliationPorts = {
	members: MemberRepository;
	tasks: TaskRepository;
};

type ReconcilePageTasksOptions = {
	defaultAssigneeId?: string | null;
};

async function validateTaskBlock(
	block: ReturnType<typeof extractTaskBlocks>[number] & {
		resolvedAssigneeId: string | null;
	},
	validAssignees: Set<string>,
) {
	if (block.due !== null && !DUE_DATE_PATTERN.test(block.due)) {
		throw appError("InvalidPageContent", {
			message: "Task due dates must be YYYY-MM-DD.",
			details: { blockId: block.blockId, due: block.due },
		});
	}
	if (
		(block.dueTime !== null && !DUE_TIME_PATTERN.test(block.dueTime)) ||
		(block.dueTime !== null && block.due === null)
	) {
		throw appError("InvalidPageContent", {
			message: "Task due times must be HH:mm and include a due date.",
			details: {
				blockId: block.blockId,
				due: block.due,
				dueTime: block.dueTime,
			},
		});
	}
	if (
		block.resolvedAssigneeId !== null &&
		!validAssignees.has(block.resolvedAssigneeId)
	) {
		throw appError("InvalidPageContent", {
			message: "Task assignees must be members of this workspace.",
			details: {
				blockId: block.blockId,
				assigneeId: block.resolvedAssigneeId,
			},
		});
	}
}

/**
 * Make the tasks table mirror the task blocks in a page document. Called from
 * the page-content save path, inside its transaction. Never mutates the
 * document: task rows are keyed by the block's own id.
 */
export async function reconcilePageTasks(
	ports: TaskReconciliationPorts,
	scope: TenantScope,
	page: PageMeta,
	content: BlockJson[],
	options: ReconcilePageTasksOptions = {},
): Promise<boolean> {
	const now = new Date().toISOString();
	const found = extractTaskBlocks(content);
	const existing = await ports.tasks.listByPage(scope, page.id);
	const existingByBlockId = new Map(
		existing
			.filter((task) => task.sourceBlockId !== null)
			.map((task) => [task.sourceBlockId as string, task]),
	);
	const resolved = found.map((block) => {
		const current = existingByBlockId.get(block.blockId);
		const resolvedAssigneeId =
			block.assignee ??
			(block.useDefaultAssignee
				? (current?.assigneeId ?? options.defaultAssigneeId ?? null)
				: null);

		return { ...block, resolvedAssigneeId };
	});
	const assigneeIds = Array.from(
		new Set(
			resolved
				.map((block) => block.resolvedAssigneeId)
				.filter((assignee): assignee is string => assignee !== null),
		),
	);
	const validAssignees = new Set(
		(
			await Promise.all(
				assigneeIds.map(async (assigneeId) => {
					const role = await ports.members.findRole(
						tenantScopeId(scope),
						assigneeId,
					);
					return role === null ? null : assigneeId;
				}),
			)
		).filter((assigneeId): assigneeId is string => assigneeId !== null),
	);
	for (const block of resolved) {
		await validateTaskBlock(block, validAssignees);
	}

	let changed = false;

	for (const block of resolved) {
		const current = existingByBlockId.get(block.blockId);

		if (!current) {
			changed = true;
			await ports.tasks.create(scope, {
				userId: page.userId,
				pageId: page.id,
				sourceBlockId: block.blockId,
				title: block.title,
				completed: block.checked,
				dueDate: block.due,
				dueTime: block.dueTime,
				assigneeId: block.resolvedAssigneeId,
				completedAt: block.checked ? now : null,
			});
			continue;
		}

		const rowChanged =
			current.title !== block.title ||
			current.completed !== block.checked ||
			current.dueDate !== block.due ||
			current.dueTime !== block.dueTime ||
			current.assigneeId !== block.resolvedAssigneeId;

		if (rowChanged) {
			changed = true;
			await ports.tasks.update(scope, current.id, {
				title: block.title,
				completed: block.checked,
				dueDate: block.due,
				dueTime: block.dueTime,
				assigneeId: block.resolvedAssigneeId,
				// Stamp/clear completedAt only when the completed state flips.
				...(current.completed !== block.checked
					? { completedAt: block.checked ? now : null }
					: {}),
			});
		}
	}

	const foundIds = new Set(found.map((block) => block.blockId));
	const orphanIds = existing
		.filter(
			(task) =>
				task.sourceBlockId !== null && !foundIds.has(task.sourceBlockId),
		)
		.map((task) => task.id);

	if (orphanIds.length > 0) {
		changed = true;
		await ports.tasks.deleteByIds(scope, orphanIds);
	}

	return changed;
}
import { tenantScopeId, type TenantScope } from "@beignet/core/ports";
