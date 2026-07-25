import { describe, expect, it } from "bun:test";
import { createStaticAuth } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestPorts } from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import { createTestApp, createTestRequester } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import {
	getChangelogStatus,
	markChangelogSeen,
} from "@/features/changelog/contracts";
import type { ChangelogStateRepository } from "@/features/changelog/ports";
import { LATEST_CHANGELOG_VERSION } from "@/features/changelog/releases";
import { changelogRoutes } from "@/features/changelog/routes";
import { appPorts } from "@/infra/app-ports";
import type { AppPorts, AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	type AuthRequest,
	type AuthSessionMetadata,
	type AuthUser,
} from "@/ports/auth";
import { type AppServiceContextInput, appContext } from "@/server/context";

function signedInAuth(): AppPorts["auth"] {
	return createStaticAuth<AuthUser, AuthSessionMetadata, AuthRequest>({
		user: {
			id: "user_test",
			email: "test@example.com",
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: "session_test", activeOrganizationId: null },
	});
}

describe("changelog routes", () => {
	it("persists the latest viewed release for the signed-in user", async () => {
		const state = new Map<string, string>();
		const changelogState: ChangelogStateRepository = {
			async getLastSeenVersion(userId) {
				return state.get(userId) ?? null;
			},
			async markSeen(userId, version) {
				state.set(userId, version);
			},
		};
		const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
			base: appPorts,
			overrides: {
				auth: signedInAuth(),
				changelogState,
				devtools: createInMemoryDevtools(),
				gate: appPorts.gate,
			},
			transaction: {
				ports: (ports) => ({ ...ports, changelogState }),
			},
		});
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: fixture.ports,
			context: appContext,
			routes: defineRoutes<AppContext>([changelogRoutes]),
		});
		const requester = createTestRequester(app, {});

		const before = await requester.request(getChangelogStatus, {});
		const seen = await requester.request(markChangelogSeen, { body: {} });
		const after = await requester.request(getChangelogStatus, {});

		await app.stop();

		expect(before.hasUnread).toBe(true);
		expect(seen.lastSeenVersion).toBe(LATEST_CHANGELOG_VERSION);
		expect(after).toEqual({
			latestVersion: LATEST_CHANGELOG_VERSION,
			lastSeenVersion: LATEST_CHANGELOG_VERSION,
			hasUnread: false,
		});
	});
});
