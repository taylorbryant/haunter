import type {
	BootstrapAdminResult,
	WaitlistUser,
} from "@/features/admin/schemas";

export interface AdminUserRepository {
	/** Whether an approved app-wide administrator already exists. */
	hasAdmin(): Promise<boolean>;
	/** Users still on the waitlist, oldest sign-ups first. */
	listWaitlisted(): Promise<WaitlistUser[]>;
	/**
	 * Approve a waitlisted user by id. Returns the user when the transition
	 * happened, or null when no waitlisted user with that id exists (already
	 * approved, or unknown) — so approval is idempotent and only sends one email.
	 */
	approve(userId: string): Promise<WaitlistUser | null>;
	/**
	 * Promote one verified account only when the app has no usable administrator.
	 * Call this through the unit of work so the check and update are atomic.
	 */
	bootstrap(email: string): Promise<BootstrapAdminResult>;
}
