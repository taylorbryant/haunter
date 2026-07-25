import "@beignet/core/server-only";
import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import type { McpOAuthRequestVerifier } from "@/features/agents/ports";

function canonicalize(params: URLSearchParams) {
	const canonical = new URLSearchParams();
	const entries = [...params.entries()].sort(
		([keyA, valueA], [keyB, valueB]) => {
			if (keyA < keyB) return -1;
			if (keyA > keyB) return 1;
			if (valueA < valueB) return -1;
			if (valueA > valueB) return 1;
			return 0;
		},
	);
	for (const [key, value] of entries) canonical.append(key, value);
	return canonical;
}

export function createBetterAuthMcpOAuthRequestVerifier(
	secret: string,
): McpOAuthRequestVerifier {
	return {
		async verify(oauthQuery) {
			const params = new URLSearchParams(oauthQuery);
			const signatures = params.getAll("sig");
			const signature = signatures[0];
			const expiresAt = Number(params.get("exp"));
			const clientId = params.get("client_id");
			const redirectUri = params.get("redirect_uri");
			if (
				signatures.length !== 1 ||
				params.getAll("client_id").length !== 1 ||
				params.getAll("redirect_uri").length !== 1 ||
				params.getAll("exp").length !== 1 ||
				!signature ||
				!clientId ||
				!redirectUri ||
				redirectUri.length > 2_048 ||
				!Number.isFinite(expiresAt) ||
				expiresAt * 1000 < Date.now()
			) {
				return null;
			}

			params.delete("sig");
			const expected = await makeSignature(
				canonicalize(params).toString(),
				secret,
			);
			return constantTimeEqual(signature, expected)
				? { clientId, redirectUri }
				: null;
		},
	};
}
