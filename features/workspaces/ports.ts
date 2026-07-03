import type { Workspace } from "@/features/workspaces/schemas";

export type NewWorkspace = {
	userId: string;
	name: string;
	icon: string | null;
	position: number;
};

export type UpdateWorkspaceData = {
	name?: string;
	icon?: string | null;
};

export interface WorkspaceRepository {
	listByUser(userId: string): Promise<Workspace[]>;
	findById(id: string): Promise<Workspace | null>;
	create(input: NewWorkspace): Promise<Workspace>;
	update(id: string, input: UpdateWorkspaceData): Promise<Workspace>;
	delete(id: string): Promise<void>;
}
