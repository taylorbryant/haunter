import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import type { TaskRepository } from "@/features/tasks/ports";
import { extractTaskBlocks } from "./extract-task-blocks";

/**
 * Make the tasks table mirror the task blocks in a page document. Called from
 * the page-content save path, inside its transaction. Never mutates the
 * document: task rows are keyed by the block's own id.
 */
export async function reconcilePageTasks(
	tasks: TaskRepository,
	page: PageMeta,
	content: BlockJson[],
): Promise<void> {
	const now = new Date().toISOString();
	const found = extractTaskBlocks(content);
	const existing = await tasks.listByPage(page.id);
	const existingByBlockId = new Map(
		existing
			.filter((task) => task.sourceBlockId !== null)
			.map((task) => [task.sourceBlockId as string, task]),
	);

	for (const block of found) {
		const current = existingByBlockId.get(block.blockId);

		if (!current) {
			await tasks.create({
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

		const changed =
			current.title !== block.title ||
			current.completed !== block.checked ||
			current.dueDate !== block.due ||
			current.assigneeId !== block.assignee;

		if (changed) {
			await tasks.update(current.id, {
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

	await tasks.deleteByIds(orphanIds);
}
