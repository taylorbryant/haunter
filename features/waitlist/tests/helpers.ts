import type {
	NewWaitlistEntry,
	WaitlistEntry,
	WaitlistRepository,
} from "@/features/waitlist/ports";

export function createTestWaitlistRepository(
	accountEmails: string[] = [],
): WaitlistRepository & {
	entries: Map<string, WaitlistEntry>;
} {
	const accounts = new Set(accountEmails.map((email) => email.toLowerCase()));
	const entries = new Map<string, WaitlistEntry>();

	return {
		entries,
		async hasAccount(email) {
			return accounts.has(email);
		},
		async join(input: NewWaitlistEntry) {
			const existing = entries.get(input.email);
			const now = new Date().toISOString();
			const entry = existing
				? { ...existing, updatedAt: now, lastRequestedAt: now }
				: {
						id: crypto.randomUUID(),
						email: input.email,
						createdAt: now,
						updatedAt: now,
						lastRequestedAt: now,
					};
			entries.set(input.email, entry);
			return entry;
		},
	};
}

