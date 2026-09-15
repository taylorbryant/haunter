import { ContractError } from "@beignet/core/client";
import {
	type MutationFunction,
	MutationObserver,
	type QueryClient,
} from "@tanstack/react-query";
import { rq } from "@/client";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import {
	removeNotificationFromCache,
	restoreRemovedNotificationCache,
} from "@/features/notifications/client/queries";
import type { Notification } from "@/features/notifications/schemas";
import {
	actOnTaskNotification,
	createTask,
	deleteTask,
	updateTask,
} from "../contracts";
import type { TaskReminderOffsetMinutes } from "../lib/reminder-options";
import type { TaskWithPage, UpdateTaskInput } from "../schemas";
import {
	createOptimisticTaskId,
	optimisticallyAddTask,
	optimisticallyPatchTask,
	optimisticallyRemoveTask,
	replaceOptimisticTask,
	restoreTaskCreationCache,
	restoreTasksCache,
} from "./queries";
import { refreshAfterTaskWrites } from "./refresh";
import {
	TASK_WRITE_KEY,
	type TaskWriteIdentity,
	taskWriteQueries,
} from "./write-state";

/** One invocation gets its own native scope/options, even when a screen edits many rows. */
export async function runTaskMutation<TData, TVariables, TSnapshot>(options: {
	queryClient: QueryClient;
	identity: TaskWriteIdentity;
	operation: string;
	variables: TVariables;
	request: MutationFunction<TData, TVariables>;
	optimistic(): Promise<TSnapshot>;
	rollback(snapshot: TSnapshot): void;
	committed?(data: NoInfer<TData>, snapshot: NoInfer<TSnapshot>): void;
}) {
	const { queryClient, identity } = options;
	const recovery = getBrowserSessionRecovery();
	const queuedEpoch = recovery?.epoch;
	let execution: { epoch: number | undefined } | undefined;
	const ownsSession = () =>
		getBrowserSessionRecovery() === recovery &&
		(!recovery || recovery.userId === identity.userId);
	const isCurrent = () =>
		execution !== undefined &&
		ownsSession() &&
		recovery?.epoch === execution.epoch &&
		!recovery?.getSnapshot().blocked;
	const sessionPaused = () =>
		new ContractError({
			source: "http",
			status: 401,
			code: "SESSION_PAUSED",
			message: "The session changed before this task could be saved.",
		});
	const requireCurrentSession = () => {
		if (!isCurrent()) throw sessionPaused();
	};
	const prepareSession = async () => {
		if (!ownsSession()) throw sessionPaused();
		if (
			recovery &&
			(recovery.epoch !== queuedEpoch || recovery.getSnapshot().blocked)
		) {
			// An unsent write can outlive a reconnect check for the same account.
			// Join verification before taking the epoch that fences its response.
			for (;;) {
				const checkingEpoch = recovery.epoch;
				const verified = await recovery.check();
				if (!ownsSession()) throw sessionPaused();
				const snapshot = recovery.getSnapshot();
				if (
					recovery.epoch !== checkingEpoch &&
					(snapshot.status === "checking" ||
						snapshot.status === "authenticated")
				)
					continue; // A newer check superseded the one we awaited.
				if (!verified || snapshot.blocked) throw sessionPaused();
				break;
			}
		}
		execution = { epoch: recovery?.epoch };
		requireCurrentSession();
	};
	const scope = [
		...TASK_WRITE_KEY,
		identity.userId,
		identity.workspaceId,
		identity.taskId,
	];
	const observer = new MutationObserver<TData, unknown, TVariables>(
		queryClient,
		{
			mutationKey: [...scope, options.operation],
			scope: { id: JSON.stringify(scope) },
			meta: { errorMode: "silent", taskWrite: identity },
			retry: false,
			mutationFn: async (variables, context) => {
				await prepareSession();
				requireCurrentSession();
				// onMutate runs before a paused scope is released. Keep optimism and
				// rollback inside mutationFn so the entire edit executes in user order.
				const snapshot = await options.optimistic();
				let data: TData;
				try {
					requireCurrentSession();
					data = await options.request(variables, context);
				} catch (error) {
					if (isCurrent()) options.rollback(snapshot);
					throw error;
				}
				requireCurrentSession();
				try {
					options.committed?.(data, snapshot);
				} catch {
					// The write succeeded. Reconciliation repairs cache failures without
					// presenting a committed create as a failed, retryable submission.
				}
				return data;
			},
			onSettled: () => {
				// Never await a gate from onSettled: this mutation is still pending here.
				if (isCurrent())
					void refreshAfterTaskWrites(queryClient, taskWriteQueries(identity));
			},
		},
	);
	try {
		return await observer.mutate(options.variables);
	} finally {
		observer.reset();
	}
}

type TaskActor = { id: string; name?: string | null; email?: string | null };
export type TaskCreationInput = {
	title: string;
	dueDate: string | null;
	dueTime: string | null;
	reminderOffsetMinutes: TaskReminderOffsetMinutes;
	assigneeId?: string | null;
};
export type TaskNotificationAction =
	| { action: "complete" }
	| { action: "snooze"; preset: "15m" | "1h" | "tomorrow_9am" };

function request<TData, TVariables>(options: {
	mutationFn?: MutationFunction<TData, TVariables>;
}): MutationFunction<TData, TVariables> {
	if (!options.mutationFn) throw new Error("Missing task mutation function");
	return options.mutationFn;
}

export function createTaskMutations(
	queryClient: QueryClient,
	actor: TaskActor,
) {
	const identify = (
		task: Pick<TaskWithPage, "workspaceId" | "id" | "pageId">,
	): TaskWriteIdentity => ({
		userId: actor.id,
		workspaceId: task.workspaceId,
		taskId: task.id,
		pageId: task.pageId,
	});
	return {
		update(
			task: TaskWithPage,
			patch: Omit<UpdateTaskInput, "id">,
			assigneeName?: string | null,
		) {
			return runTaskMutation({
				queryClient,
				identity: identify(task),
				operation: "update",
				variables: { path: { id: task.id }, body: patch },
				request: request(rq(updateTask).mutationOptions()),
				optimistic: () =>
					optimisticallyPatchTask(
						queryClient,
						task.id,
						{
							...patch,
							...(patch.completed !== undefined
								? {
										completedAt: patch.completed
											? new Date().toISOString()
											: null,
									}
								: {}),
							...(assigneeName !== undefined ? { assigneeName } : {}),
						},
						actor.id,
						task.workspaceId,
					),
				rollback: (snapshot) => restoreTasksCache(queryClient, snapshot),
			});
		},
		remove(task: TaskWithPage) {
			return runTaskMutation({
				queryClient,
				identity: identify(task),
				operation: "delete",
				variables: { path: { id: task.id } },
				request: request(rq(deleteTask).mutationOptions()),
				optimistic: () =>
					optimisticallyRemoveTask(queryClient, task.id, task.workspaceId),
				rollback: (snapshot) => restoreTasksCache(queryClient, snapshot),
			});
		},
		create(workspaceId: string, input: TaskCreationInput) {
			const performCreate = request(rq(createTask).mutationOptions());
			const now = new Date().toISOString();
			const temporary: TaskWithPage = {
				id: createOptimisticTaskId(),
				userId: actor.id,
				workspaceId,
				pageId: null,
				sourceBlockId: null,
				title: input.title,
				completed: false,
				dueDate: input.dueDate,
				dueTime: input.dueTime,
				reminderOffsetMinutes: input.reminderOffsetMinutes,
				assigneeId:
					input.assigneeId === undefined ? actor.id : input.assigneeId,
				assigneeName:
					input.assigneeId === undefined || input.assigneeId === actor.id
						? actor.name || actor.email || null
						: null,
				completedAt: null,
				createdAt: now,
				updatedAt: now,
				pageTitle: null,
			};
			return runTaskMutation({
				queryClient,
				identity: identify(temporary),
				operation: "create",
				variables: {
					body: {
						workspaceId,
						title: input.title,
						...(input.dueDate ? { dueDate: input.dueDate } : {}),
						...(input.dueTime ? { dueTime: input.dueTime } : {}),
						...(input.reminderOffsetMinutes !== null
							? { reminderOffsetMinutes: input.reminderOffsetMinutes }
							: {}),
						...(input.assigneeId !== undefined
							? { assigneeId: input.assigneeId }
							: {}),
					},
				},
				request: performCreate,
				optimistic: () =>
					optimisticallyAddTask(queryClient, temporary, actor.id),
				rollback: (snapshot) =>
					restoreTaskCreationCache(queryClient, temporary.id, snapshot),
				committed: (created) =>
					replaceOptimisticTask(queryClient, temporary.id, {
						...created,
						pageTitle: null,
						assigneeName: temporary.assigneeName,
					}),
			});
		},
		actOnNotification(item: Notification, action: TaskNotificationAction) {
			return runTaskMutation({
				queryClient,
				identity: {
					userId: actor.id,
					workspaceId: item.workspaceId,
					taskId: item.payload.taskId,
					pageId: item.payload.pageId,
					notificationId: item.id,
				},
				operation: "notification",
				variables:
					action.action === "complete"
						? { path: { id: item.id }, body: { action: "complete" as const } }
						: { path: { id: item.id }, body: action },
				request: request(rq(actOnTaskNotification).mutationOptions()),
				optimistic: () => removeNotificationFromCache(queryClient, item),
				rollback: (snapshot) =>
					restoreRemovedNotificationCache(queryClient, snapshot),
			});
		},
	};
}
