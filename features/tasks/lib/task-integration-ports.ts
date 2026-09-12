import "@beignet/core/server-only";
import type {
	EmbeddedTaskProjectionDependencies,
	EmbeddedTaskProjectionPort,
} from "@/features/tasks/ports";
import { reconcilePageTasks } from "./reconcile-page-tasks";
import { resolveTaskAssignmentActor } from "./task-assignment-notifications";

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
