import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { ContractError } from "@beignet/core/client";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { reportUserError, subscribeUserErrors } from "./error-feedback";
import {
	installSessionRecovery,
	protectedRefetchInterval,
	SessionRecovery,
	sessionFetch,
} from "./session-recovery";

beforeAll(installTestDom);
afterAll(uninstallTestDom);
let cleanup: (() => void) | undefined;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
afterEach(() => {
	cleanup?.();
	fetchSpy?.mockRestore();
});
const initial = { workspaceId: "workspace", role: "member" };
function mockFetch(implementation: () => Promise<Response>) {
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(implementation, { preconnect: fetch.preconnect }),
	);
}
test("parallel 401s create one incident, silence duplicate toasts and stop protected traffic and polling", async () => {
	let checks = 0;
	const recovery = new SessionRecovery(
		"owner",
		async () => {
			checks++;
			return null;
		},
		initial,
	);
	cleanup = installSessionRecovery(recovery);
	mockFetch(async () => new Response(null, { status: 401 }));
	await Promise.all([
		sessionFetch("/api/a"),
		sessionFetch("/api/b"),
		sessionFetch("/api/c"),
	]);
	expect(recovery.getSnapshot().status).toBe("expired");
	const received: string[] = [];
	const unsubscribe = subscribeUserErrors((message) => received.push(message));
	for (let n = 0; n < 3; n++)
		reportUserError(
			new ContractError({
				source: "http",
				status: 401,
				message: "Unauthorized",
			}),
		);
	unsubscribe();
	expect(received).toEqual([]);
	expect(checks).toBe(1);
	expect(protectedRefetchInterval()).toBe(false);
	const count = fetchSpy.mock.calls.length;
	expect((await sessionFetch("/api/write", { method: "POST" })).status).toBe(
		401,
	);
	expect(fetchSpy.mock.calls).toHaveLength(count);
});
test("a late successful mutation from the old session is never accepted or replayed", async () => {
	const recovery = new SessionRecovery(
		"owner",
		async () => ({ ...initial, userId: "other" }),
		initial,
	);
	cleanup = installSessionRecovery(recovery);
	let finish!: (response: Response) => void;
	mockFetch(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const write = sessionFetch("/api/write", { method: "POST" });
	await recovery.recheck();
	finish(Response.json({ saved: true }));
	expect((await write).status).toBe(401);
	expect(fetchSpy.mock.calls).toHaveLength(1);
	expect(recovery.getSnapshot().status).toBe("account-changed");
});
test("conflicts and connectivity failures remain distinct from session expiry", async () => {
	let checks = 0;
	const recovery = new SessionRecovery(
		"owner",
		async () => {
			checks++;
			return null;
		},
		initial,
	);
	cleanup = installSessionRecovery(recovery);
	mockFetch(async () => new Response(null, { status: 409 }));
	expect((await sessionFetch("/api/write")).status).toBe(409);
	expect(checks).toBe(0);
	expect(recovery.getSnapshot().blocked).toBe(false);
	fetchSpy.mockRestore();
	mockFetch(async () => {
		throw new TypeError("Failed to fetch");
	});
	await expect(sessionFetch("/api/write")).rejects.toBeInstanceOf(TypeError);
	expect(recovery.getSnapshot().blocked).toBe(false);
});
