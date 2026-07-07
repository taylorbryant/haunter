import type {
	AuthRequestLike,
	AuthPort as BeignetAuthPort,
	AuthSession as BeignetAuthSession,
} from "@beignet/core/ports";

export type AuthRequest = AuthRequestLike;

export const ACCESS_STATUS_APPROVED = "approved";
export const ACCESS_STATUS_WAITLISTED = "waitlisted";

export type AccessStatus = string;

export type AuthUser = {
	id: string;
	email?: string;
	name?: string;
	tenantId?: string;
	organizationId?: string;
	accessStatus?: AccessStatus;
};

export type AuthSessionMetadata = {
	id?: string;
	tenantId?: string;
	organizationId?: string;
	// Better Auth organization plugin: the active workspace for this session.
	activeOrganizationId?: string | null;
};

export type AuthSession = BeignetAuthSession<AuthUser, AuthSessionMetadata>;

export type AuthPort = BeignetAuthPort<
	AuthUser,
	AuthSessionMetadata,
	AuthRequest
>;
