import { z } from "zod";

export const WorkspaceSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	name: z.string().min(1),
	icon: z.string().nullable(),
	position: z.number(),
	createdAt: z.string().datetime(),
});

export const ListWorkspacesOutputSchema = z.object({
	items: z.array(WorkspaceSchema),
});

export const WorkspaceIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreateWorkspaceInputSchema = z.object({
	name: z.string().min(1).max(80),
	icon: z.string().max(16).optional(),
});

export const UpdateWorkspaceBodySchema = z.object({
	name: z.string().min(1).max(80).optional(),
	icon: z.string().max(16).nullable().optional(),
});

export const UpdateWorkspaceInputSchema = WorkspaceIdInputSchema.merge(
	UpdateWorkspaceBodySchema,
);

export const DeleteWorkspaceOutputSchema = z.void();

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInputSchema>;
