import type { AdminUserRepository } from "@/features/admin/ports";
import type { WaitlistUser } from "@/features/admin/schemas";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
} from "@/ports/auth";

export type SeedUser = {
	id: string;
	email: string;
	name?: string;
	accessStatus?: string;
	createdAt?: string;
};

type StoredUser = Required<Omit<SeedUser, "accessStatus">> & {
	accessStatus: string;
};

function toWaitlistUser(user: StoredUser): WaitlistUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		createdAt: user.createdAt,
	};
}

/**
 * In-memory AdminUserRepository mirroring the Drizzle implementation's
 * contract: listWaitlisted returns only waitlisted users oldest-first, and
 * approve flips exactly one waitlisted user, returning null otherwise so the
 * transition is idempotent.
 */
export function createTestAdminUserRepository(seed: SeedUser[] = []) {
	const users = new Map<string, StoredUser>();
	for (const [index, user] of seed.entries()) {
		users.set(user.id, {
			id: user.id,
			email: user.email,
			name: user.name ?? "",
			accessStatus: user.accessStatus ?? ACCESS_STATUS_WAITLISTED,
			// Deterministic increasing timestamps so ordering is stable in tests.
			createdAt:
				user.createdAt ?? `2026-01-0${index + 1}T00:00:00.000Z`,
		});
	}

	const repository: AdminUserRepository = {
		async listWaitlisted() {
			return Array.from(users.values())
				.filter((user) => user.accessStatus === ACCESS_STATUS_WAITLISTED)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map(toWaitlistUser);
		},
		async approve(userId: string) {
			const user = users.get(userId);
			if (!user || user.accessStatus !== ACCESS_STATUS_WAITLISTED) {
				return null;
			}
			user.accessStatus = ACCESS_STATUS_APPROVED;
			return toWaitlistUser(user);
		},
	};

	return {
		repository,
		statusOf: (id: string) => users.get(id)?.accessStatus,
	};
}

export { ACCESS_STATUS_APPROVED, ACCESS_STATUS_WAITLISTED };
