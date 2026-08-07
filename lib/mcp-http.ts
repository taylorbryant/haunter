import { env } from "@/lib/env";

function exactOrigin(value: string | undefined) {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (!["http:", "https:"].includes(url.protocol)) return null;
		return url.origin;
	} catch {
		// Better Auth permits wildcard trusted-origin patterns. MCP browser
		// access is deliberately exact-origin only, so patterns are ignored.
		return null;
	}
}

const configuredOrigins = new Set(
	[
		env.APP_URL,
		env.BETTER_AUTH_URL,
		...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
		...(env.MCP_ALLOWED_ORIGINS?.split(",") ?? []),
	]
		.map(exactOrigin)
		.filter((value): value is string => value !== null),
);

export function isAllowedMcpOrigin(request: Request) {
	const origin = request.headers.get("origin");
	if (!origin) return true;
	try {
		return configuredOrigins.has(new URL(origin).origin);
	} catch {
		return false;
	}
}

export function mcpClientIp(request: Request) {
	return (
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		request.headers.get("x-real-ip")?.trim() ||
		"unknown"
	);
}

export function mcpCorsHeaders(request: Request) {
	const origin = request.headers.get("origin");
	const headers = new Headers({
		"Access-Control-Allow-Headers":
			"Authorization, Content-Type, Mcp-Method, Mcp-Name, Mcp-Protocol-Version, Mcp-Session-Id",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Expose-Headers":
			"Mcp-Session-Id, WWW-Authenticate, Retry-After",
		Vary: "Origin",
	});
	if (origin && isAllowedMcpOrigin(request)) {
		headers.set("Access-Control-Allow-Origin", origin);
	}
	return headers;
}

export function withMcpCors(response: Response, request: Request) {
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "no-store");
	for (const [name, value] of mcpCorsHeaders(request)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
