export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles that may edit workspace content. Viewers are read-only. */
export function canEditContent(role: string | null | undefined): boolean {
	return role != null && role !== "viewer";
}

/** Roles that may manage members and invitations. */
export function canManageMembers(role: string | null | undefined): boolean {
	return role === "owner" || role === "admin";
}
