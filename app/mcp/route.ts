import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { mcpResourceUrl, oauthIssuerUrl } from "@/lib/better-auth";
import {
	isAllowedMcpOrigin,
	mcpClientIp,
	mcpCorsHeaders,
	withMcpCors,
} from "@/lib/mcp-http";
import { getServer } from "@/server";
import {
	createRemoteMcpRequestHandler,
	REMOTE_MCP_SCOPES,
	remoteMcpIdentityFromJwt,
} from "@/server/remote-mcp";

export const maxDuration = 60;

const MAX_MCP_REQUEST_BYTES = 1_000_000;

async function readBoundedMcpRequest(
	request: Request,
): Promise<Request | Response> {
	if (request.method !== "POST" || !request.body) return request;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_MCP_REQUEST_BYTES) {
				await reader.cancel();
				return new Response("MCP request is too large.", { status: 413 });
			}
			chunks.push(value);
		}
	} catch {
		return new Response("MCP request body could not be read.", { status: 400 });
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const headers = new Headers(request.headers);
	headers.delete("content-length");
	return new Request(request.url, {
		method: request.method,
		headers,
		body,
		signal: request.signal,
	});
}

const authenticatedHandler = createMcpProtectedRequestHandler(
	{
		issuer: oauthIssuerUrl,
		audience: mcpResourceUrl,
		jwksUrl: `${oauthIssuerUrl}/jwks`,
		requiredScopes: ["haunter:mcp"],
		challengeScopes: REMOTE_MCP_SCOPES,
	},
	async (request, jwt) => {
		const identity = remoteMcpIdentityFromJwt(jwt);
		if (!identity) {
			return new Response("The access token is missing the required scope.", {
				status: 403,
			});
		}

		const server = await getServer();
		const userLimit = await server.ports.rateLimit.hit({
			key: `mcp:user-client:${identity.userId}:${identity.clientId}`,
			limit: 180,
			windowSec: 60,
		});
		if (!userLimit.allowed) {
			return new Response("Too many MCP requests.", {
				status: 429,
				headers: userLimit.retryAfterSeconds
					? { "Retry-After": String(userLimit.retryAfterSeconds) }
					: undefined,
			});
		}

		const connection = await server.ports.mcpConnections.findActive(
			identity.userId,
			identity.clientId,
		);
		if (!connection) {
			return new Response(
				"Open Haunter and approve this client's workspace access.",
				{ status: 403 },
			);
		}

		return createRemoteMcpRequestHandler({
			connection,
			identity,
			getServer,
		})(request);
	},
);

async function handler(request: Request) {
	if (!isAllowedMcpOrigin(request)) {
		return withMcpCors(
			new Response("Origin is not allowed.", { status: 403 }),
			request,
		);
	}
	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > MAX_MCP_REQUEST_BYTES) {
		return withMcpCors(
			new Response("MCP request is too large.", { status: 413 }),
			request,
		);
	}

	const server = await getServer();
	const ipLimit = await server.ports.rateLimit.hit({
		key: `mcp:ip:${mcpClientIp(request)}`,
		limit: 300,
		windowSec: 60,
	});
	if (!ipLimit.allowed) {
		return withMcpCors(
			new Response("Too many MCP requests.", {
				status: 429,
				headers: ipLimit.retryAfterSeconds
					? { "Retry-After": String(ipLimit.retryAfterSeconds) }
					: undefined,
			}),
			request,
		);
	}

	const boundedRequest = await readBoundedMcpRequest(request);
	if (boundedRequest instanceof Response) {
		return withMcpCors(boundedRequest, request);
	}
	const response = await authenticatedHandler(boundedRequest);
	if (response.status === 401) {
		const headers = new Headers(response.headers);
		const challenge =
			headers.get("WWW-Authenticate") ??
			`Bearer resource_metadata="${new URL(
				"/.well-known/oauth-protected-resource/mcp",
				mcpResourceUrl,
			)}"`;
		headers.set(
			"WWW-Authenticate",
			`${challenge}, scope="${REMOTE_MCP_SCOPES.join(" ")}"`,
		);
		return withMcpCors(
			new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			}),
			request,
		);
	}
	return withMcpCors(response, request);
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export function OPTIONS(request: Request) {
	return new Response(null, { status: 204, headers: mcpCorsHeaders(request) });
}
