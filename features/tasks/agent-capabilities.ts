import "@beignet/core/server-only";
import { z } from "zod";
import { TASK_TITLE_MAX_LENGTH } from "@/features/tasks/schemas";
import { defineAgentCapability } from "@/lib/agent-capabilities";
import { isDueOverdue } from "@/lib/due-date";
import { localDateAndTime } from "@/lib/timezone";

const DueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const WorkspaceInput = z.object({ workspaceId: z.string().min(1) });
const TaskInput = WorkspaceInput.extend({ taskId: z.string().uuid() });

export type TaskAgentCapabilityDependencies = {
	getTimezone?: (userId: string) => Promise<string>;
	now?: () => Date;
};

function addDays(date: string, days: number) {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export function createTaskAgentCapabilities(
	dependencies: TaskAgentCapabilityDependencies = {},
) {
	const listTasksCapability = defineAgentCapability("list_tasks", {
		description:
			"List tasks in one workspace. Defaults to open tasks assigned to the acting user; supports completion/scope filters, explicit due-date ranges, and timezone-aware overdue, today, or upcoming presets.",
		input: WorkspaceInput.extend({
			filter: z.enum(["open", "completed", "all"]).default("open"),
			scope: z.enum(["mine", "everyone"]).default("mine"),
			dueOnOrAfter: DueDate.optional(),
			dueOnOrBefore: DueDate.optional(),
			due: z.enum(["overdue", "today", "upcoming"]).optional(),
			limit: z.number().int().min(1).max(200).default(50),
		}).superRefine((input, ctx) => {
			if (input.due && (input.dueOnOrAfter || input.dueOnOrBefore)) {
				ctx.addIssue({
					code: "custom",
					message: "Do not combine due with explicit due date bounds.",
					path: ["due"],
				});
			}
			if (
				input.dueOnOrAfter &&
				input.dueOnOrBefore &&
				input.dueOnOrAfter > input.dueOnOrBefore
			) {
				ctx.addIssue({
					code: "custom",
					message: "dueOnOrAfter must not be later than dueOnOrBefore.",
					path: ["dueOnOrAfter"],
				});
			}
		}),
		output: z.object({
			tasks: z.array(
				z.object({
					taskId: z.string().uuid(),
					title: z.string(),
					completed: z.boolean(),
					dueDate: DueDate.nullable(),
					dueTime: DueTime.nullable(),
					assigneeId: z.string().nullable(),
					assigneeName: z.string().nullable(),
					pageId: z.string().uuid().nullable(),
					pageTitle: z.string().nullable(),
					completedAt: z.string().nullable(),
					updatedAt: z.string(),
				}),
			),
			hasMore: z.boolean(),
		}),
		async handle({ ctx, principal, input }) {
			let dueOnOrAfter = input.dueOnOrAfter;
			let dueOnOrBefore = input.dueOnOrBefore;
			let localNow: { date: string; time: string } | null = null;
			if (input.due) {
				const timezone = dependencies.getTimezone
					? await dependencies.getTimezone(principal.userId)
					: (await ctx.ports.notificationInbox.getPreferences(principal.userId))
							.timezone;
				localNow = localDateAndTime(
					dependencies.now?.() ?? new Date(),
					timezone,
				);
				const today = localNow.date;
				if (input.due === "overdue") dueOnOrBefore = today;
				if (input.due === "today") {
					dueOnOrAfter = today;
					dueOnOrBefore = today;
				}
				if (input.due === "upcoming") dueOnOrAfter = addDays(today, 1);
			}
			const { listTasksUseCase } = await import("@/features/tasks/use-cases");
			const result = await listTasksUseCase.run({
				ctx,
				input: {
					workspaceId: input.workspaceId,
					filter: input.filter,
					scope: input.scope,
					limit: input.limit,
					...(dueOnOrAfter ? { dueOnOrAfter } : {}),
					...(dueOnOrBefore ? { dueOnOrBefore } : {}),
				},
			});
			const items =
				input.due === "overdue" && localNow
					? result.items.filter((task) =>
							isDueOverdue(
								task.dueDate,
								task.dueTime,
								localNow.date,
								localNow.time,
							),
						)
					: result.items;
			return {
				tasks: items.map((task) => ({
					taskId: task.id,
					title: task.title,
					completed: task.completed,
					dueDate: task.dueDate,
					dueTime: task.dueTime,
					assigneeId: task.assigneeId,
					assigneeName: task.assigneeName,
					pageId: task.pageId,
					pageTitle: task.pageTitle,
					completedAt: task.completedAt,
					updatedAt: task.updatedAt,
				})),
				hasMore: result.hasMore,
			};
		},
	});

	const createTaskCapability = defineAgentCapability("create_task", {
		description:
			"Create a standalone task in a workspace. The task is assigned to the acting user by default; dueDate uses YYYY-MM-DD and optional dueTime uses HH:mm.",
		input: WorkspaceInput.extend({
			title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
			dueDate: DueDate.optional(),
			dueTime: DueTime.optional(),
			assigneeId: z.string().nullable().optional(),
		}).refine(
			(input) => input.dueTime === undefined || input.dueDate !== undefined,
			{ message: "dueDate is required when dueTime is set." },
		),
		output: z.object({
			taskId: z.string().uuid(),
			title: z.string(),
			completed: z.boolean(),
			dueDate: DueDate.nullable(),
			dueTime: DueTime.nullable(),
			assigneeId: z.string().nullable(),
			createdAt: z.string(),
			updatedAt: z.string(),
		}),
		async handle({ ctx, input }) {
			const { createTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await createTaskUseCase.run({
				ctx,
				input: {
					workspaceId: input.workspaceId,
					title: input.title,
					...(input.dueDate ? { dueDate: input.dueDate } : {}),
					...(input.dueTime ? { dueTime: input.dueTime } : {}),
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
				dueTime: task.dueTime,
				assigneeId: task.assigneeId,
				createdAt: task.createdAt,
				updatedAt: task.updatedAt,
			};
		},
	});

	const updateTaskCapability = defineAgentCapability("update_task", {
		description:
			"Update a task's title, due date/time, or assignee. Set dueDate to null to clear both date and time; set dueTime to null to keep the date without a time. Page-backed task titles must still be edited in their page.",
		input: TaskInput.extend({
			title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
			dueDate: DueDate.nullable().optional(),
			dueTime: DueTime.nullable().optional(),
			assigneeId: z.string().nullable().optional(),
		}).refine(
			(input) =>
				input.title !== undefined ||
				input.dueDate !== undefined ||
				input.dueTime !== undefined ||
				input.assigneeId !== undefined,
			{
				message: "Provide a title, dueDate, dueTime, or assigneeId to update.",
			},
		),
		output: z.object({
			taskId: z.string().uuid(),
			title: z.string(),
			completed: z.boolean(),
			dueDate: DueDate.nullable(),
			dueTime: DueTime.nullable(),
			assigneeId: z.string().nullable(),
			updatedAt: z.string(),
		}),
		async handle({ ctx, input }) {
			const { updateTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await updateTaskUseCase.run({
				ctx,
				input: {
					id: input.taskId,
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
					...(input.dueTime !== undefined ? { dueTime: input.dueTime } : {}),
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
				dueTime: task.dueTime,
				assigneeId: task.assigneeId,
				updatedAt: task.updatedAt,
			};
		},
	});

	const completeTaskCapability = defineAgentCapability("complete_task", {
		description:
			"Mark a task complete. For a page-backed task, the source task block is checked too.",
		input: TaskInput,
		output: z.object({
			taskId: z.string().uuid(),
			title: z.string(),
			completed: z.literal(true),
			completedAt: z.string().nullable(),
			updatedAt: z.string(),
		}),
		async handle({ ctx, input }) {
			const { updateTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await updateTaskUseCase.run({
				ctx,
				input: { id: input.taskId, completed: true },
			});
			return {
				taskId: task.id,
				title: task.title,
				completed: true as const,
				completedAt: task.completedAt,
				updatedAt: task.updatedAt,
			};
		},
	});

	const reopenTaskCapability = defineAgentCapability("reopen_task", {
		description:
			"Reopen a completed task. For a page-backed task, the source task block is unchecked too.",
		input: TaskInput,
		output: z.object({
			taskId: z.string().uuid(),
			title: z.string(),
			completed: z.literal(false),
			completedAt: z.string().nullable(),
			updatedAt: z.string(),
		}),
		async handle({ ctx, input }) {
			const { updateTaskUseCase } = await import("@/features/tasks/use-cases");
			const task = await updateTaskUseCase.run({
				ctx,
				input: { id: input.taskId, completed: false },
			});
			return {
				taskId: task.id,
				title: task.title,
				completed: false as const,
				completedAt: task.completedAt,
				updatedAt: task.updatedAt,
			};
		},
	});

	const deleteTaskCapability = defineAgentCapability("delete_task", {
		description:
			"Permanently delete a standalone task. Page-backed tasks must be removed from their source page instead.",
		input: TaskInput,
		output: z.object({ taskId: z.string().uuid(), deleted: z.literal(true) }),
		async handle({ ctx, input }) {
			const { deleteTaskUseCase } = await import("@/features/tasks/use-cases");
			await deleteTaskUseCase.run({ ctx, input: { id: input.taskId } });
			return { taskId: input.taskId, deleted: true as const };
		},
	});

	return [
		listTasksCapability,
		createTaskCapability,
		updateTaskCapability,
		completeTaskCapability,
		reopenTaskCapability,
		deleteTaskCapability,
	] as const;
}
