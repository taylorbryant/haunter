import "server-only";

import { createNextClient } from "@beignet/next";
import { createReactQuery } from "@beignet/react-query";

function requestBaseUrl(headers: Headers): string | undefined {
	const host = headers.get("x-forwarded-host") ?? headers.get("host");
	if (!host) return undefined;
	const protocol =
		headers.get("x-forwarded-proto") ??
		(host.startsWith("localhost") || host.startsWith("127.0.0.1")
			? "http"
			: "https");
	return `${protocol}://${host}`;
}

export function createServerReactQuery(headers: Headers) {
	const cookie = headers.get("cookie");
	const apiClient = createNextClient({
		baseUrl: requestBaseUrl(headers),
		headers: async (): Promise<Record<string, string>> =>
			cookie ? { cookie } : {},
		validateInput: true,
	});

	return createReactQuery(apiClient);
}
