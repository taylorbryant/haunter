import type {
	AuthRequestLike,
	AuthPort as BeignetAuthPort,
	AuthSession as BeignetAuthSession,
} from "@beignet/core/ports";

export type AuthRequest = AuthRequestLike;

export const ACCESS_STATUS_APPROVED = "approved";
export const ACCESS_STATUS_WAITLISTED = "waitlisted";

export type AccessStatus = string;

// Better Auth admin plugin role. App-wide, distinct from per-workspace member
// roles the organization plugin governs.
export const ADMIN_ROLE = "admin";

export type AuthUser = {
	id: string;
	email?: string;
	name?: string;
	image?: string | null;
	tenantId?: string;
	organizationId?: string;
	accessStatus?: AccessStatus;
	// null/"user" for a regular member; "admin" grants the admin surface.
	role?: string | null;
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
