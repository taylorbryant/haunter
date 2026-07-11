import { z } from "zod";

export const ListWorkspaceMembersInputSchema = z.object({
	workspaceId: z.string().min(1),
});

export const WorkspaceMemberSchema = z.object({
	userId: z.string(),
	name: z.string(),
	email: z.string().email(),
	role: z.string(),
});

export const ListWorkspaceMembersOutputSchema = z.object({
	items: z.array(WorkspaceMemberSchema),
});
