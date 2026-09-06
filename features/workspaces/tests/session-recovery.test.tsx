import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeAll(installTestDom);
afterAll(uninstallTestDom);

test("verified recovery refreshes the real Better Auth workspace and membership caches", async () => {
	const { authClient } = await import("@/client/auth-client");
	const { useWorkspaces } = await import("../client/use-workspaces");
	const { SessionRecoveryProvider } = await import(
		"@/components/session-recovery-provider"
	);
	const { getBrowserSessionRecovery } = await import(
		"@/client/session-recovery"
	);
	const owner = {
		id: "workspace-recovery-owner",
		name: "Owner",
		email: "owner@example.test",
		image: null,
	};
	const workspace = {
		id: "workspace",
		name: "Recovered workspace",
		slug: "workspace",
		createdAt: new Date().toISOString(),
	};
	const member = {
		id: "membership",
		userId: owner.id,
		organizationId: workspace.id,
		role: "owner",
		createdAt: new Date().toISOString(),
		user: owner,
	};
	let signedInUser: typeof owner | null = owner;
	let verification: Promise<void> = Promise.resolve();
	const lookups: string[] = [];
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof fetch>[0]) => {
				const path = new URL(String(input), window.location.origin).pathname;
				if (path === "/api/auth/sign-in/email-otp") {
					signedInUser = owner;
					return Response.json({ user: owner, token: "synthetic" });
				}
				if (path === "/api/auth/get-session") {
					await verification;
					return Response.json(
						signedInUser
							? {
									user: signedInUser,
									session: { activeOrganizationId: workspace.id },
								}
							: null,
					);
				}
				lookups.push(path);
				if (!signedInUser)
					return Response.json({ message: "Unauthorized" }, { status: 401 });
				switch (path) {
					case "/api/auth/organization/list":
						return Response.json([workspace]);
					case "/api/auth/organization/get-full-organization":
						return Response.json({
							...workspace,
							members: [member],
							invitations: [],
						});
					case "/api/auth/organization/get-active-member":
						return Response.json(member);
					case "/api/auth/organization/get-active-member-role":
						return Response.json({ role: member.role });
					default:
						throw new Error(`Unexpected request: ${path}`);
				}
			},
			{ preconnect: fetch.preconnect },
		),
	);
	let refresh: () => Promise<void> = async () => {};
	function WorkspaceData() {
		const workspaces = useWorkspaces();
		const organization = authClient.useActiveOrganization();
		const activeMember = authClient.useActiveMember();
		const role = authClient.useActiveMemberRole();
		refresh = async () => {
			await Promise.all([
				workspaces.refetch(),
				organization.refetch(),
				activeMember.refetch(),
				role.refetch(),
			]);
		};
		return (
			<>
				<output data-testid="workspaces">
					{workspaces.error
						? "Workspaces unavailable"
						: workspaces.workspaces.map((w) => w.name).join(", ")}
				</output>
				<output data-testid="organization">
					{organization.error ? "Unavailable" : organization.data?.name}
				</output>
				<output data-testid="member">
					{activeMember.error ? "Unavailable" : activeMember.data?.userId}
				</output>
				<output data-testid="role">
					{role.error ? "Unavailable" : role.data?.role}
				</output>
			</>
		);
	}
	const queryClient = new QueryClient();
	try {
		const view = render(
			<QueryClientProvider client={queryClient}>
				<SessionRecoveryProvider
					initial={{
						user: owner,
						activeWorkspaceId: workspace.id,
						workspaceRole: "owner",
						isAdmin: false,
					}}
					onVerified={() => {}}
				>
					<textarea aria-label="Draft" defaultValue="Keep my latest sentence" />
					<WorkspaceData />
				</SessionRecoveryProvider>
			</QueryClientProvider>,
		);
		const recovery = getBrowserSessionRecovery();
		if (!recovery) throw new Error("Recovery was not installed");
		const editor = view.getByRole("textbox", { name: "Draft" });
		const expectAvailable = () => {
			expect(view.getByTestId("workspaces").textContent).toBe(workspace.name);
			expect(view.getByTestId("organization").textContent).toBe(workspace.name);
			expect(view.getByTestId("member").textContent).toBe(owner.id);
			expect(view.getByTestId("role").textContent).toBe("owner");
		};
		await waitFor(expectAvailable);
		signedInUser = null;
		await act(async () => {
			await refresh();
			await recovery.check();
		});
		expect(recovery.getSnapshot().status).toBe("expired");
		expect(view.getByTestId("workspaces").textContent).toBe(
			"Workspaces unavailable",
		);

		// An account mismatch must not trigger authenticated cache refreshes.
		signedInUser = { ...owner, id: "different-account" };
		const beforeMismatch = lookups.length;
		await act(async () => {
			await recovery.recheck();
		});
		expect(recovery.getSnapshot().status).toBe("account-changed");
		expect(lookups).toHaveLength(beforeMismatch);

		let finishVerification!: () => void;
		verification = new Promise((resolve) => {
			finishVerification = resolve;
		});
		await act(async () => {
			await authClient.signIn.emailOtp({ email: owner.email, otp: "123456" });
		});
		expect(recovery.getSnapshot().blocked).toBe(true);
		// SDK lookups made before workspace verification finishes remain blocked.
		const beforeVerification = lookups.length;
		await act(async () => {
			await refresh();
		});
		expect(lookups).toHaveLength(beforeVerification);
		await act(async () => {
			finishVerification();
			await recovery.recheck();
		});
		expect(recovery.getSnapshot().blocked).toBe(false);
		await waitFor(expectAvailable);
		expect(view.getByRole("textbox", { name: "Draft" })).toBe(editor);
		expect((editor as HTMLTextAreaElement).value).toBe(
			"Keep my latest sentence",
		);
		const beforeHealthyCheck = lookups.filter(
			(path) => path === "/api/auth/organization/list",
		).length;
		await act(async () => {
			await recovery.check();
		});
		expect(
			lookups.filter((path) => path === "/api/auth/organization/list"),
		).toHaveLength(beforeHealthyCheck);
	} finally {
		await act(async () => {
			cleanup();
		});
		queryClient.clear();
		fetchSpy.mockRestore();
	}
});
