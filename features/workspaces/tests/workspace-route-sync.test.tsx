import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

let activeId = "original";
let blocked = false;
let epoch = 0;
const refresh = mock(() => {});
const setActive = mock(
	async (_input: {
		organizationId: string;
	}): Promise<{ error: null | { message: string } }> => ({ error: null }),
);
const reportError = mock(() => {});
mock.module("@/client/use-draft-safe-router", () => ({
	useDraftSafeRouter: () => ({ refresh }),
}));
mock.module("@/components/session-recovery-provider", () => ({
	useProtectedRequestsEnabled: () => !blocked,
}));
mock.module("@/components/app-session-provider", () => ({
	useAppSession: () => ({ activeWorkspaceId: activeId }),
}));
mock.module("@/client/auth-client", () => ({
	authClient: { organization: { setActive } },
}));
mock.module("@/client/error-feedback", () => ({
	authErrorMessage: (error: { message: string }) => error.message,
	reportUserError: reportError,
}));
mock.module("@/client/session-recovery", () => ({
	getBrowserSessionRecovery: () => ({
		get epoch() {
			return epoch;
		},
		getSnapshot: () => ({ blocked }),
	}),
}));
let useWorkspaceRouteSync: typeof import("../client/use-workspace-route-sync").useWorkspaceRouteSync;
beforeAll(async () => {
	installTestDom();
	({ useWorkspaceRouteSync } = await import(
		"../client/use-workspace-route-sync"
	));
});
afterEach(() => {
	cleanup();
	setActive.mockClear();
	refresh.mockClear();
	reportError.mockClear();
	activeId = "original";
	blocked = false;
	epoch = 0;
});
afterAll(uninstallTestDom);

const strict = ({ children }: { children: ReactNode }) => (
	<StrictMode>{children}</StrictMode>
);

test("activation runs once and content stays gated until the refreshed session agrees", async () => {
	const response = Promise.withResolvers<{ error: null }>();
	setActive.mockImplementation(() => response.promise);
	const view = renderHook(
		() => useWorkspaceRouteSync("destination", { syncActive: true }),
		{ wrapper: strict },
	);
	await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
	expect(view.result.current.synced).toBe(false);
	expect(refresh).not.toHaveBeenCalled();
	await act(async () => response.resolve({ error: null }));
	await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	expect(view.result.current.synced).toBe(false);
	activeId = "destination";
	view.rerender();
	expect(view.result.current.synced).toBe(true);
	expect(setActive).toHaveBeenCalledTimes(1);
});

test("failed activation stops until an explicit retry", async () => {
	setActive.mockImplementation(async () => ({
		error: { message: "Workspace unavailable" },
	}));
	const view = renderHook(() =>
		useWorkspaceRouteSync("destination", { syncActive: true }),
	);
	await waitFor(() =>
		expect(view.result.current.error).toBe("Workspace unavailable"),
	);
	view.rerender();
	await act(async () => {});
	expect(setActive).toHaveBeenCalledTimes(1);
	expect(refresh).not.toHaveBeenCalled();
	setActive.mockImplementation(async () => ({ error: null }));
	act(() => view.result.current.retry());
	await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	expect(setActive).toHaveBeenCalledTimes(2);
	expect(view.result.current.error).toBeNull();
});

test("an activation from an obsolete session cannot refresh or unlock the destination", async () => {
	const response = Promise.withResolvers<{ error: null }>();
	setActive.mockImplementation(() => response.promise);
	const view = renderHook(() =>
		useWorkspaceRouteSync("destination", { syncActive: true }),
	);
	await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
	epoch++;
	blocked = true;
	await act(async () => response.resolve({ error: null }));
	expect(refresh).not.toHaveBeenCalled();
	expect(view.result.current.synced).toBe(false);
});
