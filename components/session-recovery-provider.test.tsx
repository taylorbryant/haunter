import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { draftRegistry } from "@/client/draft-registry";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

let SessionRecoveryProvider: typeof import("./session-recovery-provider").SessionRecoveryProvider;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let unregister: (() => void) | undefined;
let queryClient: QueryClient;
beforeAll(async () => {
	installTestDom();
	SessionRecoveryProvider = (await import("./session-recovery-provider"))
		.SessionRecoveryProvider;
});
afterEach(async () => {
	await act(async () => {
		cleanup();
		unregister?.();
	});
	queryClient?.clear();
	fetchSpy?.mockRestore();
});
afterAll(uninstallTestDom);

test.each(["account-changed", "access-lost"] as const)(
	"keeps the mounted editor restricted after %s until recovery succeeds",
	async (failure) => {
		const owner = crypto.randomUUID();
		const initial = {
			user: {
				id: owner,
				name: "Owner",
				email: "owner@example.test",
				image: null,
			},
			activeWorkspaceId: "workspace",
			workspaceRole: "member",
			isAdmin: false,
		};
		const session = {
			user: { id: owner },
			session: { activeOrganizationId: "workspace" },
		};
		let role = "member";
		let respond = async () => Response.json(session);
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (url: Parameters<typeof fetch>[0]) => {
					if (String(url).startsWith("/api/auth/get-session")) return respond();
					if (String(url) === "/api/auth/organization/get-active-member")
						return Response.json({
							userId: owner,
							organizationId: "workspace",
							role,
						});
					throw new Error(`Unexpected request: ${url}`);
				},
				{ preconnect: fetch.preconnect },
			),
		);
		// A registered draft makes the export action visible and requires edit access.
		unregister = draftRegistry.register({
			identity: {
				key: owner,
				userId: owner,
				workspaceId: "workspace",
				resourceId: "page",
				resourceType: "page-title",
			},
			getSnapshot: () => ({
				status: "saved",
				dirty: false,
				locallySaved: true,
				value: "Keep this draft",
				serverValue: "Keep this draft",
				serverVersion: "v1",
				error: null,
				validationError: null,
			}),
			subscribe: () => () => {},
			pause: () => {},
			resume: () => {},
			flushLocal: async () => {},
			flushServer: async () => true,
		});
		queryClient = new QueryClient();
		const view = render(
			<QueryClientProvider client={queryClient}>
				<SessionRecoveryProvider initial={initial} onVerified={() => {}}>
					<textarea aria-label="Draft" defaultValue="Keep this draft" />
				</SessionRecoveryProvider>
			</QueryClientProvider>,
		);
		const recovery = getBrowserSessionRecovery();
		if (!recovery) throw new Error("Recovery was not installed");
		await act(async () => {
			await recovery.check();
		});
		const editor = view.getByRole("textbox", {
			name: "Draft",
		}) as HTMLTextAreaElement;
		const wrapper = editor.parentElement;
		if (!wrapper) throw new Error("Editor has no wrapper");
		if (failure === "account-changed")
			respond = async () =>
				Response.json({ ...session, user: { id: "other" } });
		else role = "viewer";
		await act(async () => {
			await recovery.recheck();
		});
		expect(recovery.getSnapshot().status).toBe(failure);
		function expectRestricted() {
			expect(editor.isConnected).toBe(true);
			expect(editor.value).toBe("Keep this draft");
			expect(wrapper?.hidden).toBe(failure === "account-changed");
			expect(wrapper?.hasAttribute("inert")).toBe(true);
			expect(
				view.queryByRole("button", { name: "Download draft" }) === null,
			).toBe(failure === "account-changed");
			if (failure === "account-changed")
				expect(view.container.textContent).not.toContain("Download your draft");
		}
		expectRestricted();

		let reject!: (error: Error) => void;
		respond = () =>
			new Promise((_resolve, fail) => {
				reject = fail;
			});
		await act(async () => {
			window.dispatchEvent(new Event("online"));
		});
		expect(recovery.getSnapshot().status).toBe("checking");
		expectRestricted();
		await act(async () => {
			reject(new TypeError("offline"));
			await recovery.check();
		});
		expect(recovery.getSnapshot().status).toBe("error");
		expectRestricted();
		respond = async () => Response.json(null);
		await act(async () => {
			await recovery.recheck();
		});
		expect(recovery.getSnapshot().status).toBe("expired");
		expectRestricted();
		respond = async () => Response.json(session);
		role = "member";
		await act(async () => {
			await recovery.recheck();
		});
		await waitFor(() => expect(wrapper.hidden).toBe(false));
		expect(wrapper.hasAttribute("inert")).toBe(false);
		expect(view.getByRole("textbox", { name: "Draft" })).toBe(editor);
		expect(editor.value).toBe("Keep this draft");
	},
);
