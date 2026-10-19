import { expect, test } from "bun:test";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";
import { validateOAuthDcrRequest } from "@/lib/oauth-dcr-request";
import { AuthProvider } from "@/packages/cli/src/auth";
import { ProfileStore } from "@/packages/cli/src/config";

const origin = "https://haunter.example";

async function register(metadata: Record<string, unknown>) {
	const auth = betterAuth({
		baseURL: origin,
		secret: "isolated-cli-registration-test-secret-2026",
		database: memoryAdapter({ oauthClient: [], verification: [], jwks: [] }),
		plugins: [
			jwt(),
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/oauth/consent",
				scopes: ["openid", "offline_access", "haunter:mcp"],
				clientRegistrationAllowedScopes: [
					"openid",
					"offline_access",
					"haunter:mcp",
				],
				grantTypes: ["authorization_code", "refresh_token"],
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
				silenceWarnings: { oauthAuthServerConfig: true },
			}),
		],
	});
	const validation = await validateOAuthDcrRequest(
		new Request(`${origin}/api/auth/oauth2/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(metadata),
		}),
	);
	if ("response" in validation) return validation.response;
	return auth.handler(validation.request);
}

function clientMetadata(redirectUrl?: string) {
	const store = new ProfileStore(
		"/unused-cli-registration-test",
		`${origin}/mcp`,
	);
	return new AuthProvider(store, {
		version: 1,
		server: store.server,
		redirectUrl,
	}).clientMetadata;
}

test.each([undefined, "http://127.0.0.1:43822/callback"])(
	"CLI callback %s registers through Haunter's guard and real OAuth provider",
	async (redirectUrl) => {
		const metadata = clientMetadata(redirectUrl);
		const response = await register(metadata);
		const body = await response.json();
		expect(body).toMatchObject({
			application_type: "native",
			client_id: expect.any(String),
			redirect_uris: metadata.redirect_uris,
			token_endpoint_auth_method: "none",
		});
		expect(response.status).toBe(201);
		expect(body.client_secret).toBeUndefined();
	},
);

test("native registration still rejects HTTP callbacks outside loopback", async () => {
	const response = await register(
		clientMetadata("http://example.com/callback"),
	);
	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({
		error: "invalid_redirect_uri",
	});
});
