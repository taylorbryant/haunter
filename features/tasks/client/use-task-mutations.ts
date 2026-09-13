"use client";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/components/app-session-provider";
import { createTaskMutations } from "./mutations";
import {
	hasPendingTaskWrite,
	TASK_WRITE_KEY,
	taskWriteIdentity,
} from "./write-state";

export function useTaskMutations(workspaceId?: string) {
	const queryClient = useQueryClient();
	const actor = useCurrentUser();
	const pending = useMutationState({
		filters: {
			mutationKey: [...TASK_WRITE_KEY, actor?.id],
			status: "pending",
			predicate: (mutation) =>
				!workspaceId ||
				taskWriteIdentity(mutation)?.workspaceId === workspaceId,
		},
		select: (mutation) => taskWriteIdentity(mutation),
	});
	const mutations = () => {
		if (!actor) throw new Error("Sign in to save tasks.");
		return createTaskMutations(queryClient, actor);
	};
	return {
		pendingTaskIds: new Set(
			pending.flatMap((identity) => (identity ? [identity.taskId] : [])),
		),
		isPending: (workspaceId: string, taskId: string) =>
			!!actor &&
			hasPendingTaskWrite(queryClient, actor.id, workspaceId, taskId),
		update: (
			...args: Parameters<ReturnType<typeof createTaskMutations>["update"]>
		) => mutations().update(...args),
		remove: (
			...args: Parameters<ReturnType<typeof createTaskMutations>["remove"]>
		) => mutations().remove(...args),
		create: (
			...args: Parameters<ReturnType<typeof createTaskMutations>["create"]>
		) => mutations().create(...args),
		actOnNotification: (
			...args: Parameters<
				ReturnType<typeof createTaskMutations>["actOnNotification"]
			>
		) => mutations().actOnNotification(...args),
	};
}
