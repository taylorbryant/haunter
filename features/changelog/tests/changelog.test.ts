import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import {
	createTestContextFactory,
	createTestPorts,
	createTestUserActor,
} from "@beignet/core/testing";
import type { AppContext } from "@/app-context";
import type { ChangelogStateRepository } from "@/features/changelog/ports";
import { LATEST_CHANGELOG_VERSION } from "@/features/changelog/releases";
import {
	getChangelogStatusUseCase,
	markChangelogSeenUseCase,
} from "@/features/changelog/use-cases";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

function createFixture() {
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
			changelogState,
			gate: appPorts.gate,
		},
		transaction: {
			ports: (ports) => ({ ...ports, changelogState }),
		},
	});
	const auth = {
		user: {
			id: "user_test",
			email: "test@example.com",
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: "session_test", activeOrganizationId: null },
	};
	const createContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(auth.user.id),
		auth,
	});

	return {
		state,
		tester: createUseCaseTester<AppContext>(createContext),
	};
}

describe("changelog status", () => {
	it("is unread until the signed-in user views the latest release", async () => {
		const { tester, state } = createFixture();

		const before = await tester.run(getChangelogStatusUseCase, {});
		const seen = await tester.run(markChangelogSeenUseCase, {});
		const after = await tester.run(getChangelogStatusUseCase, {});

		expect(before).toEqual({
			latestVersion: LATEST_CHANGELOG_VERSION,
			lastSeenVersion: null,
			hasUnread: true,
		});
		expect(seen).toEqual({
			lastSeenVersion: LATEST_CHANGELOG_VERSION,
			hasUnread: false,
		});
		expect(after).toEqual({
			latestVersion: LATEST_CHANGELOG_VERSION,
			lastSeenVersion: LATEST_CHANGELOG_VERSION,
			hasUnread: false,
		});
		expect(state.get("user_test")).toBe(LATEST_CHANGELOG_VERSION);
	});
});
