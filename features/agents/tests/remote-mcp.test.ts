import { describe, expect, test } from "bun:test";
import {
	allowedRemoteMcpCapabilities,
	remoteMcpIdentityFromJwt,
} from "@/server/remote-mcp";

describe("remote MCP authorization", () => {
	test("requires a delegated user, OAuth client, and Haunter scope", () => {
		expect(
			remoteMcpIdentityFromJwt({
				sub: "user_test",
				client_id: "client_test",
				scope: "openid haunter:mcp",
			}),
		).toEqual({ userId: "user_test", clientId: "client_test" });
		expect(
			remoteMcpIdentityFromJwt({
				sub: "user_test",
				azp: "legacy_client_test",
				scope: "haunter:mcp",
			}),
		).toEqual({ userId: "user_test", clientId: "legacy_client_test" });
		expect(
			remoteMcpIdentityFromJwt({
				sub: "user_test",
				azp: "client_test",
				scope: "openid",
			}),
		).toBeNull();
		expect(
			remoteMcpIdentityFromJwt({
				sub: "user_test",
				scope: "haunter:mcp",
			}),
		).toBeNull();
	});

	test("exposes only capabilities in the saved permission profile", () => {
		const view = allowedRemoteMcpCapabilities({ permissionProfile: "view" });
		const edit = allowedRemoteMcpCapabilities({ permissionProfile: "edit" });
		const full = allowedRemoteMcpCapabilities({ permissionProfile: "full" });

		expect(view.has("read_page")).toBeTrue();
		expect(view.has("update_page")).toBeFalse();
		expect(edit.has("update_page")).toBeTrue();
		expect(edit.has("delete_task")).toBeFalse();
		expect(full.has("delete_task")).toBeTrue();
	});
});
