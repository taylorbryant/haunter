export interface MemberRepository {
	/** The user's role in the organization, or null when they are not a member. */
	findRole(organizationId: string, userId: string): Promise<string | null>;
}
