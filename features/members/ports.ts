import type { TenantScope } from "@beignet/core/ports";

export type WorkspaceMember = {
	userId: string;
	name: string;
	email: string;
	role: string;
};

export interface MemberRepository {
	/** The user's role in the organization, or null when they are not a member. */
	findRole(organizationId: string, userId: string): Promise<string | null>;
	/** The tenant-scoped roster used for assignee discovery. */
	listByWorkspace(scope: TenantScope): Promise<WorkspaceMember[]>;
}
