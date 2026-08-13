import "@beignet/core/server-only";
import { extractDocumentSearchText } from "@/features/content/document-text";
import { appError } from "@/features/shared/errors";
import type {
	EmbeddedTaskProjectionDependencies,
	EmbeddedTaskProjectionPort,
	TaskSourceDocumentPort,
	TaskSourceDocumentRepository,
} from "@/features/tasks/ports";
import { patchTaskBlock } from "./patch-task-block";
import { reconcilePageTasks } from "./reconcile-page-tasks";
import { resolveTaskAssignmentActor } from "./task-assignment-notifications";

const TASK_BLOCK_PATCH_ATTEMPTS = 3;

export function createEmbeddedTaskProjectionPort(
	dependencies: EmbeddedTaskProjectionDependencies,
): EmbeddedTaskProjectionPort {
	return {
		async reconcile(scope, source, options) {
			const assignmentActor = options?.assignmentUser
				? await resolveTaskAssignmentActor(
						dependencies.members,
						scope,
						options.assignmentUser,
					)
				: options?.assignmentActor;
			return reconcilePageTasks(dependencies, scope, source, source.content, {
				...options,
				assignmentActor,
			});
		},
	};
}

export function createTaskSourceDocumentPort(
	documents: TaskSourceDocumentRepository,
): TaskSourceDocumentPort {
	return {
		async patchTaskBlock(scope, input) {
			let page = await documents.findById(scope, input.pageId);

			for (
				let attempt = 0;
				page && attempt < TASK_BLOCK_PATCH_ATTEMPTS;
				attempt += 1
			) {
				const patched = patchTaskBlock(
					page.content,
					input.blockId,
					input.patch,
				);
				if (!patched.found) return null;

				const saved = await documents.saveContentIf(
					scope,
					page.id,
					JSON.stringify(patched.blocks),
					extractDocumentSearchText(patched.blocks),
					page.contentUpdatedAt,
				);
				if (saved) {
					return {
						pageId: page.id,
						pageContentUpdatedAt: saved.contentUpdatedAt,
					};
				}

				page = await documents.findById(scope, input.pageId);
			}

			if (page) {
				throw appError("StaleWrite", { details: { id: input.pageId } });
			}
			return null;
		},
	};
}

export function createTaskIntegrationPorts(
	dependencies: EmbeddedTaskProjectionDependencies & {
		documents: TaskSourceDocumentRepository;
	},
): {
	pageTaskProjection: EmbeddedTaskProjectionPort;
	taskSourceDocuments: TaskSourceDocumentPort;
} {
	return {
		pageTaskProjection: createEmbeddedTaskProjectionPort(dependencies),
		taskSourceDocuments: createTaskSourceDocumentPort(dependencies.documents),
	};
}
