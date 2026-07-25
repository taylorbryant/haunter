import { describe, expect, test } from "bun:test";
import {
	applyOAuthDcrAllocationMetadata,
	OAUTH_DCR_ALLOCATION_MARKER_PREFIX,
	OAUTH_DCR_ALLOCATION_METADATA_KEY,
	OAUTH_DCR_MAX_BODY_BYTES,
	stripOAuthDcrInternalMetadata,
	validateOAuthDcrRequest,
} from "@/lib/oauth-dcr-request";

function request(body: string, headers: HeadersInit = {}) {
	return new Request("https://haunter.app/api/auth/oauth2/register", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});
}

describe("OAuth dynamic client registration request guard", () => {
	test("makes a bounded registration sessionless and assigns its source partition", async () => {
		const body = JSON.stringify({
			client_name: "Codex",
			redirect_uris: ["http://127.0.0.1:1455/callback"],
			grant_types: ["authorization_code", "refresh_token"],
			token_endpoint_auth_method: "none",
		});

		const result = await validateOAuthDcrRequest(
			request(body, {
				authorization: "Bearer session-token",
				cookie: "better-auth.session_token=session-token",
				"x-forwarded-for": "203.0.113.10",
			}),
		);

		expect("request" in result).toBeTrue();
		if (!("request" in result)) return;
		expect(result.request.headers.get("authorization")).toBeNull();
		expect(result.request.headers.get("cookie")).toBeNull();
		expect(await result.request.json()).toEqual(JSON.parse(body));
		expect(result.allocationKey).not.toBe("attacker-controlled");
	});

	test("persists the server allocation through Better Auth's database hook", () => {
		const client = applyOAuthDcrAllocationMetadata(
			{
				clientId: "client_test",
				metadata: JSON.stringify({ client_extension: "preserved" }),
			},
			"a".repeat(43),
		);

		expect(JSON.parse(String(client.metadata))).toEqual({
			client_extension: "preserved",
			[OAUTH_DCR_ALLOCATION_METADATA_KEY]: `${OAUTH_DCR_ALLOCATION_MARKER_PREFIX}${"a".repeat(43)}`,
		});
	});

	test("rejects oversized bodies before parsing them", async () => {
		const result = await validateOAuthDcrRequest(
			request("{}", {
				"content-length": String(OAUTH_DCR_MAX_BODY_BYTES + 1),
			}),
		);

		expect("response" in result).toBeTrue();
		if (!("response" in result)) return;
		expect(result.response.status).toBe(413);
		await expect(result.response.json()).resolves.toMatchObject({
			error: "invalid_client_metadata",
		});
	});

	test("rejects unbounded metadata and redirect collections", async () => {
		const tooManyRedirects = await validateOAuthDcrRequest(
			request(
				JSON.stringify({
					redirect_uris: Array.from(
						{ length: 11 },
						(_, index) => `http://127.0.0.1:${3000 + index}/callback`,
					),
				}),
			),
		);
		expect("response" in tooManyRedirects).toBeTrue();
		if ("response" in tooManyRedirects) {
			expect(tooManyRedirects.response.status).toBe(400);
		}

		const nestedMetadata = await validateOAuthDcrRequest(
			request(
				JSON.stringify({
					redirect_uris: ["http://127.0.0.1:3000/callback"],
					metadata: { a: { b: { c: { d: { e: true } } } } },
				}),
			),
		);
		expect("response" in nestedMetadata).toBeTrue();
		if ("response" in nestedMetadata) {
			expect(nestedMetadata.response.status).toBe(400);
		}
	});

	test("does not expose Haunter's allocation marker in DCR responses", async () => {
		const response = await stripOAuthDcrInternalMetadata(
			Response.json(
				{
					client_id: "client_test",
					[OAUTH_DCR_ALLOCATION_METADATA_KEY]: "v1:private-source",
				},
				{ status: 201 },
			),
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			client_id: "client_test",
		});
	});
});
