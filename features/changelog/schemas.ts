import { z } from "zod";

export const ChangelogStatusSchema = z.object({
	latestVersion: z.string().min(1),
	lastSeenVersion: z.string().nullable(),
	hasUnread: z.boolean(),
});
export type ChangelogStatus = z.infer<typeof ChangelogStatusSchema>;

export const MarkChangelogSeenOutputSchema = z.object({
	lastSeenVersion: z.string().min(1),
	hasUnread: z.literal(false),
});
