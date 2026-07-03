import type {
	NewWorkspace,
	UpdateWorkspaceData,
	WorkspaceRepository,
} from "@/features/workspaces/ports";
import type { Workspace } from "@/features/workspaces/schemas";

export function createTestWorkspaceRepository(): WorkspaceRepository {
	const workspaces = new Map<string, Workspace>();

	return {
		async listByUser(userId: string) {
			return Array.from(workspaces.values())
				.filter((workspace) => workspace.userId === userId)
				.sort((left, right) => left.position - right.position);
		},
		async findById(id: string) {
			return workspaces.get(id) ?? null;
		},
		async create(input: NewWorkspace) {
			const workspace: Workspace = {
				id: crypto.randomUUID(),
				userId: input.userId,
				name: input.name,
				icon: input.icon,
				position: input.position,
				createdAt: new Date().toISOString(),
			};
			workspaces.set(workspace.id, workspace);
			return workspace;
		},
		async update(id: string, input: UpdateWorkspaceData) {
			const workspace = workspaces.get(id);
			if (!workspace) {
				throw new Error(`Workspace not found: ${id}`);
			}

			const next = { ...workspace, ...input };
			workspaces.set(id, next);
			return next;
		},
		async delete(id: string) {
			workspaces.delete(id);
		},
	};
}
