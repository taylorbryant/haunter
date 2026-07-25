import { describe, expect, test } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { createBetterAuthMcpOAuthRequestVerifier } from "@/infra/agents/better-auth-mcp-oauth-request-verifier";

const secret = "test-secret-that-is-long-enough-for-signing";
const verifier = createBetterAuthMcpOAuthRequestVerifier(secret);

async function signedQuery(
	clientId: string,
	redirectUri = "http://127.0.0.1:1455/callback",
	expiresAt = Math.floor(Date.now() / 1000) + 60,
) {
	const unsigned = `client_id=${encodeURIComponent(clientId)}&exp=${expiresAt}&redirect_uri=${encodeURIComponent(redirectUri)}`;
	const signature = await makeSignature(unsigned, secret);
	return `${unsigned}&sig=${encodeURIComponent(signature)}`;
}

describe("Better Auth MCP OAuth request verifier", () => {
	test("returns the client from an unexpired signed query", async () => {
		await expect(
			verifier.verify(await signedQuery("client_test")),
		).resolves.toEqual({
			clientId: "client_test",
			redirectUri: "http://127.0.0.1:1455/callback",
		});
	});

	test("rejects modified, expired, and duplicate signatures", async () => {
		const valid = await signedQuery("client_test");
		await expect(
			verifier.verify(valid.replace("client_test", "client_other")),
		).resolves.toBeNull();
		await expect(
			verifier.verify(
				await signedQuery("client_test", "http://127.0.0.1:1455/callback", 1),
			),
		).resolves.toBeNull();
		await expect(verifier.verify(`${valid}&sig=another`)).resolves.toBeNull();
		await expect(
			verifier.verify(
				`${valid}&redirect_uri=${encodeURIComponent("https://evil.example/callback")}`,
			),
		).resolves.toBeNull();
	});
});
