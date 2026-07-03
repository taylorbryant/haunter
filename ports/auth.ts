import type {
	AuthPort as BeignetAuthPort,
	AuthRequestLike,
	AuthSession as BeignetAuthSession,
} from "@beignet/core/ports";

export type AuthRequest = AuthRequestLike;

export type AuthUser = {
	id: string;
	email?: string;
	name?: string;
	tenantId?: string;
	organizationId?: string;
};

export type AuthSessionMetadata = {
	id?: string;
	tenantId?: string;
	organizationId?: string;
};

export type AuthSession = BeignetAuthSession<AuthUser, AuthSessionMetadata>;

export type AuthPort = BeignetAuthPort<
	AuthUser,
	AuthSessionMetadata,
	AuthRequest
>;
