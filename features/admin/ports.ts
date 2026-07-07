import type { WaitlistUser } from "@/features/admin/schemas";

export interface AdminUserRepository {
	/** Users still on the waitlist, oldest sign-ups first. */
	listWaitlisted(): Promise<WaitlistUser[]>;
	/**
	 * Approve a waitlisted user by id. Returns the user when the transition
	 * happened, or null when no waitlisted user with that id exists (already
	 * approved, or unknown) — so approval is idempotent and only sends one email.
	 */
	approve(userId: string): Promise<WaitlistUser | null>;
}
