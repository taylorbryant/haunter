import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CallToolResult,
	ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { login } from "../src/auth";
import { runCli } from "../src/cli";
import { ProfileStore } from "../src/config";

export const PAGE_ID = "23ea928a-0f1c-4f38-a00d-2169e04c9e28";
export const TASK_ID = "1101d030-24f6-49a5-a617-b2cd19e30f96";
export async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "haunter-cli-"));
	const calls: { name: string; arguments: Record<string, unknown> }[] = [];
	let origin = "";
	let redirect = "";
	let challenge = "";
	let refreshes = 0;
	let currentAccess = "access-1";
	let currentRefresh = "refresh-1";
	let rejectTokens = false;
	let toolError = false;
	let toolPages: ListToolsResult[] = [{ tools: [] }];
	const listCursors: (string | undefined)[] = [];
	const toolResults = new Map<string, CallToolResult>();
	let workspaces = [{ id: "workspace-1", name: "Personal", role: "owner" }];
	const server = createServer(async (req, res) => {
		const respond = (data: unknown, status = 200) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(data));
		};
		try {
			const url = new URL(req.url ?? "/", origin);
			if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
				return respond({
					resource: `${origin}/mcp`,
					authorization_servers: [origin],
					scopes_supported: ["haunter:mcp", "offline_access"],
				});
			if (url.pathname === "/.well-known/oauth-authorization-server")
				return respond({
					issuer: origin,
					authorization_endpoint: `${origin}/authorize`,
					token_endpoint: `${origin}/token`,
					registration_endpoint: `${origin}/register`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
					scopes_supported: ["haunter:mcp", "offline_access"],
				});
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = Buffer.concat(chunks).toString();
			if (url.pathname === "/register") {
				const metadata = JSON.parse(body);
				redirect = metadata.redirect_uris[0];
				return respond({ ...metadata, client_id: "haunter-cli-test" }, 201);
			}
			if (url.pathname === "/token") {
				const params = new URLSearchParams(body);
				if (params.get("resource") !== `${origin}/mcp`)
					return respond({ error: "invalid_target" }, 400);
				if (params.get("grant_type") === "authorization_code") {
					const digest = createHash("sha256")
						.update(params.get("code_verifier") ?? "")
						.digest("base64url");
					if (
						params.get("code") !== "test-code" ||
						digest !== challenge ||
						params.get("redirect_uri") !== redirect
					)
						return respond({ error: "invalid_grant" }, 400);
				} else if (
					params.get("refresh_token") === currentRefresh &&
					!rejectTokens
				) {
					refreshes++;
					currentAccess = `access-${refreshes + 1}`;
					currentRefresh = `refresh-${refreshes + 1}`;
				} else return respond({ error: "invalid_grant" }, 400);
				return respond({
					access_token: currentAccess,
					refresh_token: currentRefresh,
					token_type: "Bearer",
					expires_in: 3600,
					scope: "haunter:mcp offline_access",
				});
			}
			if (url.pathname !== "/mcp") return respond({}, 404);
			if (
				req.headers.authorization !== `Bearer ${currentAccess}` ||
				rejectTokens
			) {
				res.setHeader(
					"WWW-Authenticate",
					`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
				);
				return respond({ error: "unauthorized" }, 401);
			}
			if (req.method !== "POST") return respond({}, 405);
			const message = JSON.parse(body);
			if (message.id === undefined) {
				res.writeHead(202).end();
				return;
			}
			const reply = (result: unknown) =>
				respond({ jsonrpc: "2.0", id: message.id, result });
			if (message.method === "initialize")
				return reply({
					protocolVersion: message.params.protocolVersion,
					capabilities: { tools: {} },
					serverInfo: { name: "haunter-test", version: "1" },
				});
			if (message.method === "tools/list") {
				const cursor = message.params?.cursor;
				listCursors.push(cursor);
				const index =
					cursor === undefined
						? 0
						: toolPages.findIndex((page) => page.nextCursor === cursor) + 1;
				return reply(toolPages[index] ?? { tools: [] });
			}
			if (message.method !== "tools/call") return reply({});
			const { name, arguments: args } = message.params;
			calls.push({ name, arguments: args });
			if (toolError)
				return reply({
					isError: true,
					content: [
						{ type: "text", text: "You do not have access to this workspace." },
					],
				});
			if (toolResults.has(name)) return reply(toolResults.get(name));
			const task = {
				taskId: TASK_ID,
				title: args.title ?? "Test task",
				completed: name === "complete_task",
				dueDate: args.dueDate ?? null,
			};
			const results: Record<string, unknown> = {
				list_workspaces: { workspaces },
				list_pages: { pages: [{ pageId: PAGE_ID, title: "Notes\u001b[31m" }] },
				search_pages: { pages: [{ pageId: PAGE_ID, title: "Meeting" }] },
				read_page: {
					pageId: PAGE_ID,
					title: "Notes",
					markdown: "# Hello\n\nA page body.",
				},
				create_page: { pageId: PAGE_ID, title: args.title },
				append_to_page: {
					pageId: args.pageId,
					title: "Notes",
					appendedBlocks: 1,
				},
				list_tasks: { tasks: [task], hasMore: false },
				create_task: task,
				complete_task: task,
			};
			const result = results[name];
			return reply({
				structuredContent: result,
				content: [{ type: "text", text: JSON.stringify(result) }],
			});
		} catch {
			respond({ error: "fixture error" }, 500);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const store = new ProfileStore(directory, `${origin}/mcp`);
	return {
		store,
		directory,
		calls,
		listCursors,
		setToolPages(value: ListToolsResult[]) {
			toolPages = value;
		},
		setToolResult(name: string, result: CallToolResult) {
			toolResults.set(name, result);
		},
		get refreshes() {
			return refreshes;
		},
		setWorkspaces(value: typeof workspaces) {
			workspaces = value;
		},
		setToolError() {
			toolError = true;
		},
		expire() {
			currentAccess = "expired";
		},
		revoke() {
			rejectTokens = true;
		},
		async signIn() {
			const profile = await store.load();
			await login(store, profile, {
				port: 0,
				signal: AbortSignal.timeout(4000),
				notice: () => {},
				open: async (url) => {
					challenge = url.searchParams.get("code_challenge") ?? "";
					if (url.searchParams.get("code_challenge_method") !== "S256")
						throw new Error("Missing PKCE");
					const redirectUri = url.searchParams.get("redirect_uri");
					const state = url.searchParams.get("state");
					if (!redirectUri || !state)
						throw new Error("Missing redirect URI or state");
					const callback = new URL(redirectUri);
					callback.searchParams.set("state", state);
					callback.searchParams.set("code", "test-code");
					const response = await fetch(callback);
					if (!response.ok) throw new Error("Callback failed");
				},
			});
		},
		async run(
			args: string[],
			stdin = "",
			env: Record<string, string | undefined> = {},
		) {
			let stdout = "",
				stderr = "";
			const code = await runCli(args, {
				stdout: (text) => {
					stdout += text;
				},
				stderr: (text) => {
					stderr += text;
				},
				stdin: (async function* () {
					yield stdin;
				})(),
				isTTY: !stdin,
				env: {
					HAUNTER_CONFIG_DIR: directory,
					HAUNTER_SERVER: store.server,
					...env,
				},
			});
			return { code, stdout, stderr };
		},
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(directory, { recursive: true, force: true });
		},
	};
}
