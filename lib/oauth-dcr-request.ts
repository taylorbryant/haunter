import "@beignet/core/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { getIp } from "@better-auth/core/utils/ip";
import { z } from "zod";
import { env } from "@/lib/env";

export const OAUTH_DCR_MAX_BODY_BYTES = 16 * 1024;
export const OAUTH_DCR_MAX_UNUSED_CLIENTS = 1_000;
export const OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE = 50;
export const OAUTH_DCR_UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1_000;
export const OAUTH_DCR_CLEANUP_LIMIT = 500;
export const OAUTH_DCR_ALLOCATION_METADATA_KEY = "_haunter_dcr_allocation";
export const OAUTH_DCR_ALLOCATION_MARKER_PREFIX = "v1:";

const oauthDcrAllocation = new AsyncLocalStorage<string>();

const UriSchema = z.string().trim().min(1).max(2_048);
const DynamicClientRegistrationSchema = z
	.object({
		client_name: z.string().trim().min(1).max(200).optional(),
		client_uri: UriSchema.optional(),
		logo_uri: UriSchema.optional(),
		contacts: z.array(z.string().trim().min(1).max(320)).max(10).optional(),
		tos_uri: UriSchema.optional(),
		policy_uri: UriSchema.optional(),
		software_id: z.string().trim().min(1).max(200).optional(),
		software_version: z.string().trim().min(1).max(200).optional(),
		software_statement: z.string().max(4_096).optional(),
		redirect_uris: z.array(UriSchema).min(1).max(10),
		post_logout_redirect_uris: z.array(UriSchema).max(10).optional(),
		scope: z.string().max(512).optional(),
		grant_types: z.array(z.string().max(64)).max(5).optional(),
		response_types: z.array(z.string().max(64)).max(5).optional(),
		token_endpoint_auth_method: z.string().max(64).optional(),
		type: z.string().max(64).optional(),
	})
	.passthrough();

type BoundedJsonState = {
	nodes: number;
};

function isBoundedJson(
	value: unknown,
	depth = 0,
	state: BoundedJsonState = { nodes: 0 },
): boolean {
	state.nodes += 1;
	if (state.nodes > 200 || depth > 4) return false;
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return true;
	}
	if (typeof value === "string") return value.length <= 4_096;
	if (Array.isArray(value)) {
		return (
			value.length <= 20 &&
			value.every((item) => isBoundedJson(item, depth + 1, state))
		);
	}
	if (typeof value !== "object") return false;
	const entries = Object.entries(value);
	return (
		entries.length <= 50 &&
		entries.every(
			([key, item]) =>
				key.length <= 128 && isBoundedJson(item, depth + 1, state),
		)
	);
}

function oauthError(
	status: number,
	error: string,
	errorDescription: string,
): Response {
	return Response.json(
		{ error, error_description: errorDescription },
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				Pragma: "no-cache",
			},
		},
	);
}

async function readBoundedBody(request: Request): Promise<string | Response> {
	const contentLength = request.headers.get("content-length");
	if (
		contentLength &&
		(!/^\d+$/.test(contentLength) ||
			Number(contentLength) > OAUTH_DCR_MAX_BODY_BYTES)
	) {
		return oauthError(
			413,
			"invalid_client_metadata",
			"Client registration metadata is too large.",
		);
	}
	if (!request.body) {
		return oauthError(
			400,
			"invalid_client_metadata",
			"Client registration metadata is required.",
		);
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > OAUTH_DCR_MAX_BODY_BYTES) {
			await reader.cancel();
			return oauthError(
				413,
				"invalid_client_metadata",
				"Client registration metadata is too large.",
			);
		}
		chunks.push(value);
	}

	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(body);
	} catch {
		return oauthError(
			400,
			"invalid_client_metadata",
			"Client registration metadata must be valid UTF-8 JSON.",
		);
	}
}

export async function validateOAuthDcrRequest(
	request: Request,
): Promise<
	{ request: Request; allocationKey: string } | { response: Response }
> {
	if (
		!request.headers
			.get("content-type")
			?.toLowerCase()
			.includes("application/json")
	) {
		return {
			response: oauthError(
				415,
				"invalid_client_metadata",
				"Client registration metadata must use application/json.",
			),
		};
	}

	const body = await readBoundedBody(request);
	if (body instanceof Response) return { response: body };

	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return {
			response: oauthError(
				400,
				"invalid_client_metadata",
				"Client registration metadata must be valid JSON.",
			),
		};
	}
	const registration = DynamicClientRegistrationSchema.safeParse(parsed);
	if (!isBoundedJson(parsed) || !registration.success) {
		return {
			response: oauthError(
				400,
				"invalid_client_metadata",
				"Client registration metadata exceeds Haunter's supported limits.",
			),
		};
	}

	const sourceIp = getIp(request, {}) ?? "no-trusted-ip";
	const allocationKey = createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(`haunter:oauth-dcr:v1:${sourceIp}`)
		.digest("base64url");
	const guardedBody = JSON.stringify(registration.data);
	if (
		new TextEncoder().encode(guardedBody).byteLength > OAUTH_DCR_MAX_BODY_BYTES
	) {
		return {
			response: oauthError(
				413,
				"invalid_client_metadata",
				"Client registration metadata is too large.",
			),
		};
	}

	const headers = new Headers(request.headers);
	headers.delete("content-length");
	// Haunter's hosted MCP clients are public OAuth clients. Never let a
	// browser session turn DCR into an owner-scoped client that bypasses the
	// shared lifecycle and database quotas.
	headers.delete("cookie");
	headers.delete("authorization");
	return {
		request: new Request(request.url, {
			method: request.method,
			headers,
			body: guardedBody,
			signal: request.signal,
		}),
		allocationKey,
	};
}

export function withOAuthDcrAllocation<T>(
	allocationKey: string,
	callback: () => T,
): T {
	return oauthDcrAllocation.run(allocationKey, callback);
}

export function applyOAuthDcrAllocationMetadata(
	client: Record<string, unknown>,
	allocationKey = oauthDcrAllocation.getStore(),
): Record<string, unknown> {
	if (!allocationKey || !/^[A-Za-z0-9_-]{43}$/.test(allocationKey)) {
		return client;
	}

	let metadata: Record<string, unknown> = {};
	if (typeof client.metadata === "string") {
		try {
			const parsed = JSON.parse(client.metadata);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				metadata = parsed as Record<string, unknown>;
			}
		} catch {
			// Better Auth owns this field and normally supplies valid JSON.
			// Invalid legacy metadata is replaced only on a guarded DCR write.
		}
	} else if (
		client.metadata &&
		typeof client.metadata === "object" &&
		!Array.isArray(client.metadata)
	) {
		metadata = client.metadata as Record<string, unknown>;
	}

	return {
		...client,
		metadata: JSON.stringify({
			...metadata,
			[OAUTH_DCR_ALLOCATION_METADATA_KEY]:
				OAUTH_DCR_ALLOCATION_MARKER_PREFIX + allocationKey,
		}),
	};
}

export async function stripOAuthDcrInternalMetadata(
	response: Response,
): Promise<Response> {
	if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
		return response;
	}

	let payload: unknown;
	try {
		payload = await response.clone().json();
	} catch {
		return response;
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		!(OAUTH_DCR_ALLOCATION_METADATA_KEY in payload)
	) {
		return response;
	}

	const sanitized = { ...(payload as Record<string, unknown>) };
	delete sanitized[OAUTH_DCR_ALLOCATION_METADATA_KEY];
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return Response.json(sanitized, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function oauthDcrCapacityError(): Response {
	const response = oauthError(
		429,
		"temporarily_unavailable",
		"Client registration is temporarily at capacity. Try again later.",
	);
	response.headers.set("Retry-After", "60");
	return response;
}
