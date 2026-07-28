import { z } from "zod";
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
	PageMetaSchema,
} from "@/features/pages/schemas";
import {
	DueDateSchema,
	DueTimeSchema,
	TASK_TITLE_MAX_LENGTH,
	TASK_TITLE_TOO_LONG_MESSAGE,
	TaskSchema,
} from "@/features/tasks/schemas";

export const INBOX_NOTE_DETAILS_MAX_LENGTH = 20_000;
export const INBOX_NOTE_DETAILS_TOO_LONG_MESSAGE = `Note details must be ${INBOX_NOTE_DETAILS_MAX_LENGTH.toLocaleString()} characters or fewer.`;

const InboxItemBaseSchema = z.object({
	id: z.string().uuid(),
	workspaceId: z.string().min(1),
	createdAt: z.string().datetime(),
});

export const InboxPageItemSchema = InboxItemBaseSchema.extend({
	kind: z.literal("page"),
	page: PageMetaSchema,
	task: z.null(),
});

export const InboxTaskItemSchema = InboxItemBaseSchema.extend({
	kind: z.literal("task"),
	page: z.null(),
	task: TaskSchema,
});

export const InboxItemSchema = z.discriminatedUnion("kind", [
	InboxPageItemSchema,
	InboxTaskItemSchema,
]);

export const ListInboxItemsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(20),
	cursor: z.string().min(1).optional(),
});

export const ListInboxItemsInputSchema = ListInboxItemsQuerySchema.extend({
	workspaceId: z.string().min(1),
});

export const ListInboxItemsOutputSchema = z.object({
	items: z.array(InboxItemSchema),
	page: z.object({
		kind: z.literal("cursor"),
		limit: z.number().int().min(1),
		cursor: z.string().nullable(),
		nextCursor: z.string().nullable(),
		hasMore: z.boolean(),
	}),
});

const CaptureInboxBaseSchema = z.object({
	workspaceId: z.string().min(1),
});

export const CaptureInboxItemInputSchema = z.discriminatedUnion("kind", [
	CaptureInboxBaseSchema.extend({
		kind: z.literal("page"),
		title: z
			.string()
			.trim()
			.min(1)
			.max(PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE),
		details: z
			.string()
			.max(INBOX_NOTE_DETAILS_MAX_LENGTH, INBOX_NOTE_DETAILS_TOO_LONG_MESSAGE)
			.optional(),
	}),
	CaptureInboxBaseSchema.extend({
		kind: z.literal("task"),
		title: z
			.string()
			.trim()
			.min(1)
			.max(TASK_TITLE_MAX_LENGTH, TASK_TITLE_TOO_LONG_MESSAGE),
		dueDate: DueDateSchema.optional(),
		dueTime: DueTimeSchema.optional(),
	}).refine(
		(input) => input.dueTime === undefined || input.dueDate !== undefined,
		{
			message: "A due date is required when a due time is set",
			path: ["dueDate"],
		},
	),
]);

export const InboxItemIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const ResolveInboxItemBodySchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("dismiss") }),
	z.object({
		action: z.literal("file_page"),
		parentPageId: z.string().uuid().nullable(),
	}),
	z.object({
		action: z.literal("schedule_task"),
		dueDate: DueDateSchema,
		dueTime: DueTimeSchema.nullable().optional(),
	}),
	z.object({ action: z.literal("complete_task") }),
]);

const inboxItemIdShape = InboxItemIdInputSchema.shape;

export const ResolveInboxItemInputSchema = z.discriminatedUnion("action", [
	z.object({ ...inboxItemIdShape, action: z.literal("dismiss") }),
	z.object({
		...inboxItemIdShape,
		action: z.literal("file_page"),
		parentPageId: z.string().uuid().nullable(),
	}),
	z.object({
		...inboxItemIdShape,
		action: z.literal("schedule_task"),
		dueDate: DueDateSchema,
		dueTime: DueTimeSchema.nullable().optional(),
	}),
	z.object({ ...inboxItemIdShape, action: z.literal("complete_task") }),
]);

export const ResolveInboxItemOutputSchema = z.object({
	id: z.string().uuid(),
	kind: z.enum(["page", "task"]),
	action: z.enum(["dismiss", "file_page", "schedule_task", "complete_task"]),
	resourceId: z.string().uuid(),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;
export type InboxPageItem = z.infer<typeof InboxPageItemSchema>;
export type InboxTaskItem = z.infer<typeof InboxTaskItemSchema>;
export type CaptureInboxItemInput = z.infer<typeof CaptureInboxItemInputSchema>;
export type ResolveInboxItemInput = z.infer<typeof ResolveInboxItemInputSchema>;
