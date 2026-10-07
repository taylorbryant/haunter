import { mock } from "bun:test";
import assert from "node:assert/strict";
import { MAX_INLINE_FILE_BYTES } from "@/features/agents/file-input";

let authenticatedCalls = 0;
let serverCalls = 0;
mock.module("@better-auth/mcp", () => ({
	createMcpProtectedRequestHandler: () => async (request: Request) => {
		authenticatedCalls++;
		assert.equal(request.headers.get("content-length"), null);
		return Response.json(await request.json());
	},
}));
mock.module("@/lib/better-auth", () => ({
	mcpResourceUrl: "https://haunter.test/mcp",
	oauthIssuerUrl: "https://haunter.test/api/auth",
}));
mock.module("@/server", () => ({
	getServer: async () => {
		serverCalls++;
		return { ports: { rateLimit: { hit: async () => ({ allowed: true }) } } };
	},
}));
mock.module("@/server/remote-mcp", () => ({
	REMOTE_MCP_SCOPES: ["haunter:mcp"],
	createRemoteMcpRequestHandler: () => {
		throw new Error("This test stops at the authentication boundary.");
	},
	remoteMcpIdentityFromJwt: () => {
		throw new Error("This test stops at the authentication boundary.");
	},
}));
const { POST } = await import("@/app/mcp/route");

function request(body: Uint8Array, length?: number, onCancel?: () => void) {
	let offset = 0;
	return new Request("https://haunter.test/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(length === undefined ? {} : { "Content-Length": String(length) }),
		},
		body: new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset === body.length) return controller.close();
				const end = Math.min(offset + 65_536, body.length);
				controller.enqueue(body.subarray(offset, end));
				offset = end;
			},
			cancel: onCancel,
		}),
	});
}

// Exercise the exported Next handler, including both Content-Length and actual
// streamed-byte checks, with a full 2 MiB file plus the MCP JSON envelope.
const payload = {
	jsonrpc: "2.0",
	id: 1,
	method: "tools/call",
	params: {
		name: "attach_file_to_page",
		arguments: {
			workspaceId: "workspace-test",
			pageId: crypto.randomUUID(),
			expectedRevision: "revision-test",
			inlineFile: {
				name: "notes.txt",
				mimeType: "text/plain",
				data: Buffer.alloc(MAX_INLINE_FILE_BYTES, "a").toString("base64"),
			},
		},
	},
};
const encoded = Buffer.from(JSON.stringify(payload));
for (const length of [encoded.length, undefined]) {
	const before = authenticatedCalls;
	const response = await POST(request(encoded, length));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), payload);
	assert.equal(authenticatedCalls, before + 1);
}

// A declared oversized request is rejected before server startup/authentication.
const beforeServer = serverCalls;
const beforeAuth = authenticatedCalls;
assert.equal((await POST(request(encoded, 3_000_001))).status, 413);
assert.equal(serverCalls, beforeServer);
assert.equal(authenticatedCalls, beforeAuth);

// Missing or dishonest Content-Length cannot bypass the streamed-byte bound.
for (const length of [undefined, 1]) {
	let cancelled = false;
	const response = await POST(
		request(Buffer.alloc(3_100_000), length, () => {
			cancelled = true;
		}),
	);
	assert.equal(response.status, 413);
	assert.equal(await response.text(), "MCP request is too large.");
	assert.equal(cancelled, true);
	assert.equal(authenticatedCalls, beforeAuth);
}
