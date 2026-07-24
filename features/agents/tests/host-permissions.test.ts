import { describe, expect, it } from "bun:test";
import {
	disconnectAgentHost,
	rememberAgentHostPermissionProfile,
} from "../client/host-permissions";

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("agent host permission writes", () => {
	it("remembers the complete selected profile through Agent Auth", async () => {
		const requests: Array<{ path: string; body: unknown }> = [];
		const fetchImplementation = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			requests.push({
				path: String(input),
				body: JSON.parse(String(init?.body)),
			});
			return response({});
		};

		await rememberAgentHostPermissionProfile({
			hostId: "host_test",
			profile: "view",
			fetchImplementation,
		});

		expect(requests).toEqual([
			{
				path: "/api/auth/host/update",
				body: {
					host_id: "host_test",
					default_capabilities: expect.arrayContaining([
						"list_workspaces",
						"read_page",
						"list_tasks",
					]),
				},
			},
		]);
	});

	it("disconnects the host and every child agent through Agent Auth", async () => {
		const requests: Array<{ path: string; body: unknown }> = [];
		const fetchImplementation = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			requests.push({
				path: String(input),
				body: JSON.parse(String(init?.body)),
			});
			return response({
				host_id: "host_test",
				status: "revoked",
				agents_revoked: 2,
			});
		};

		await disconnectAgentHost("host_test", fetchImplementation);

		expect(requests).toEqual([
			{
				path: "/api/auth/host/revoke",
				body: { host_id: "host_test" },
			},
		]);
	});

	it("reports Agent Auth failures", async () => {
		let calls = 0;
		const fetchImplementation = async () => {
			calls += 1;
			return response({ message: "Host revoke failed" }, 500);
		};

		await expect(
			disconnectAgentHost("host_test", fetchImplementation),
		).rejects.toThrow("Host revoke failed");
		expect(calls).toBe(1);
	});
});
