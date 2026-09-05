import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	WorkspaceAccessError,
	WorkspaceSelectionError,
} from "./session-recovery";
import { verifyBrowserSession } from "./session-verification";

const input = {
	userId: "owner",
	workspaceId: "original",
	requireEdit: true,
	recover: true,
	signal: new AbortController().signal,
};
const session = {
	user: { id: "owner" },
	session: { activeOrganizationId: "original" },
};
const member = { userId: "owner", organizationId: "original", role: "member" };
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
afterEach(() => fetchSpy?.mockRestore());
function responses(...values: Array<unknown | Response>) {
	const calls: Array<{ path: string; method: string; body: unknown }> = [];
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (
				url: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				calls.push({
					path: String(url),
					method: init?.method ?? "GET",
					body: init?.body,
				});
				const result = values.shift();
				if (result === undefined) throw new Error("Unexpected request");
				return result instanceof Response ? result : Response.json(result);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	return calls;
}
describe("browser session verification", () => {
	test("renewal POST must succeed before workspace access is accepted", async () => {
		const calls = responses(
			{ ...session, needsRefresh: true },
			session,
			member,
		);
		expect(await verifyBrowserSession(input)).toEqual({
			userId: "owner",
			workspaceId: "original",
			role: "member",
		});
		expect(calls.map((call) => [call.path, call.method])).toEqual([
			["/api/auth/get-session?disableCookieCache=true", "GET"],
			["/api/auth/get-session?disableCookieCache=true", "POST"],
			["/api/auth/organization/get-active-member", "GET"],
		]);
	});
	test("a failed renewal cannot reuse the preceding successful GET", async () => {
		const calls = responses(
			{ ...session, needsRefresh: true },
			new Response(null, { status: 401 }),
		);
		expect(await verifyBrowserSession(input)).toBeNull();
		expect(calls).toHaveLength(2);
	});
	test("a different account never activates or checks the original workspace", async () => {
		const calls = responses({ ...session, user: { id: "different" } });
		expect(await verifyBrowserSession(input)).toMatchObject({
			userId: "different",
			workspaceId: null,
		});
		expect(calls).toHaveLength(1);
	});
	test("workspace drift requires pausing before activation, then checks current membership", async () => {
		responses({ ...session, session: { activeOrganizationId: "other" } });
		await expect(
			verifyBrowserSession({ ...input, recover: false }),
		).rejects.toBeInstanceOf(WorkspaceSelectionError);
		fetchSpy.mockRestore();
		const calls = responses(
			{ ...session, session: { activeOrganizationId: "other" } },
			{ id: "original" },
			member,
		);
		expect(await verifyBrowserSession(input)).toMatchObject({
			workspaceId: "original",
		});
		expect(calls[1]).toMatchObject({
			method: "POST",
			body: JSON.stringify({ organizationId: "original" }),
		});
	});
	test("a removed or downgraded member cannot resume editing", async () => {
		responses(session, { ...member, role: "viewer" });
		await expect(verifyBrowserSession(input)).rejects.toBeInstanceOf(
			WorkspaceAccessError,
		);
	});
	test("a server error is not evidence of lost workspace access", async () => {
		responses(new Response(null, { status: 500 }));
		await expect(verifyBrowserSession(input)).rejects.not.toBeInstanceOf(
			WorkspaceAccessError,
		);
	});
});
