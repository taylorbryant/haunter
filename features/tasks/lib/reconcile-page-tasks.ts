import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import type { MemberRepository } from "@/features/members/ports";
import type { TaskRepository } from "@/features/tasks/ports";
import { extractTaskBlocks } from "./extract-task-blocks";

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type TaskReconciliationPorts = {
	members: MemberRepository;
	tasks: TaskRepository;
};

async function validateTaskBlock(
	block: ReturnType<typeof extractTaskBlocks>[number],
	validAssignees: Set<string>,
) {
	if (block.due !== null && !DUE_DATE_PATTERN.test(block.due)) {
		throw appError("InvalidPageContent", {
			message: "Task due dates must be YYYY-MM-DD.",
			details: { blockId: block.blockId, due: block.due },
		});
	}
	if (block.assignee !== null && !validAssignees.has(block.assignee)) {
		throw appError("InvalidPageContent", {
			message: "Task assignees must be members of this workspace.",
			details: { blockId: block.blockId, assigneeId: block.assignee },
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
	page: PageMeta,
	content: BlockJson[],
): Promise<boolean> {
	const now = new Date().toISOString();
	const found = extractTaskBlocks(content);
	const assigneeIds = Array.from(
		new Set(
			found
				.map((block) => block.assignee)
				.filter((assignee): assignee is string => assignee !== null),
		),
	);
	const validAssignees = new Set(
		(
			await Promise.all(
				assigneeIds.map(async (assigneeId) => {
					const role = await ports.members.findRole(
						page.workspaceId,
						assigneeId,
					);
					return role === null ? null : assigneeId;
				}),
			)
		).filter((assigneeId): assigneeId is string => assigneeId !== null),
	);
	for (const block of found) {
		await validateTaskBlock(block, validAssignees);
	}

	const existing = await ports.tasks.listByPage(page.id);
	const existingByBlockId = new Map(
		existing
			.filter((task) => task.sourceBlockId !== null)
			.map((task) => [task.sourceBlockId as string, task]),
	);
	let changed = false;

	for (const block of found) {
		const current = existingByBlockId.get(block.blockId);

		if (!current) {
			changed = true;
			await ports.tasks.create({
				userId: page.userId,
				workspaceId: page.workspaceId,
				pageId: page.id,
				sourceBlockId: block.blockId,
				title: block.title,
				completed: block.checked,
				dueDate: block.due,
				assigneeId: block.assignee,
				completedAt: block.checked ? now : null,
			});
			continue;
		}

		const rowChanged =
			current.title !== block.title ||
			current.completed !== block.checked ||
			current.dueDate !== block.due ||
			current.assigneeId !== block.assignee;

		if (rowChanged) {
			changed = true;
			await ports.tasks.update(current.id, {
				title: block.title,
				completed: block.checked,
				dueDate: block.due,
				assigneeId: block.assignee,
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
		await ports.tasks.deleteByIds(orphanIds);
	}

	return changed;
}
