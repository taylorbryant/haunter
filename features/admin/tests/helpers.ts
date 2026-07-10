import type { AdminUserRepository } from "@/features/admin/ports";
import type {
	BootstrapAdminUser,
	WaitlistUser,
} from "@/features/admin/schemas";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	ADMIN_ROLE,
} from "@/ports/auth";

export type SeedUser = {
	id: string;
	email: string;
	name?: string;
	accessStatus?: string;
	emailVerified?: boolean;
	role?: string | null;
	createdAt?: string;
};

type StoredUser = Required<Omit<SeedUser, "accessStatus" | "role">> & {
	accessStatus: string;
	role: string | null;
};

function toWaitlistUser(user: StoredUser): WaitlistUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		createdAt: user.createdAt,
	};
}

function toBootstrapAdminUser(user: StoredUser): BootstrapAdminUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
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
			emailVerified: user.emailVerified ?? true,
			role: user.role ?? null,
			// Deterministic increasing timestamps so ordering is stable in tests.
			createdAt: user.createdAt ?? `2026-01-0${index + 1}T00:00:00.000Z`,
		});
	}

	const repository: AdminUserRepository = {
		async hasAdmin() {
			return Array.from(users.values()).some(
				(user) =>
					user.role === ADMIN_ROLE &&
					user.accessStatus === ACCESS_STATUS_APPROVED,
			);
		},
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
		async bootstrap(email: string) {
			const normalizedEmail = email.trim().toLowerCase();
			const existingAdmin = Array.from(users.values()).find(
				(user) =>
					user.role === ADMIN_ROLE &&
					user.accessStatus === ACCESS_STATUS_APPROVED,
			);
			if (existingAdmin) {
				return existingAdmin.email.toLowerCase() === normalizedEmail
					? {
							status: "already-admin" as const,
							user: toBootstrapAdminUser(existingAdmin),
						}
					: { status: "admin-exists" as const };
			}

			const target = Array.from(users.values()).find(
				(user) =>
					user.email.toLowerCase() === normalizedEmail && user.emailVerified,
			);
			if (!target) return { status: "user-not-found" as const };

			target.accessStatus = ACCESS_STATUS_APPROVED;
			target.role = ADMIN_ROLE;
			return {
				status: "bootstrapped" as const,
				user: toBootstrapAdminUser(target),
			};
		},
	};

	return {
		repository,
		statusOf: (id: string) => users.get(id)?.accessStatus,
		roleOf: (id: string) => users.get(id)?.role,
	};
}

export { ACCESS_STATUS_APPROVED, ACCESS_STATUS_WAITLISTED };
