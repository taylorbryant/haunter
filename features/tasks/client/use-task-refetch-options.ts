"use client";

import { useMutationState, useQueryClient } from "@tanstack/react-query";
import { TASK_WRITE_KEY, taskAwareRefetchOptions } from "./write-state";

export function useTaskRefetchOptions() {
	const queryClient = useQueryClient();
	// QueryObserver recalculates its polling timer on render, not on mutation
	// events. Subscribe so a write also pauses timers on otherwise unchanged pages.
	useMutationState({
		filters: { mutationKey: TASK_WRITE_KEY, status: "pending" },
		select: (mutation) => mutation.mutationId,
	});
	return taskAwareRefetchOptions(queryClient);
}
