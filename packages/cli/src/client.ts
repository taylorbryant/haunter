import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	CallToolResultSchema,
	ListToolsResultSchema,
	type CallToolResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { version } from "../package.json";
import { AuthProvider, boundedFetch, LOGIN_REQUIRED } from "./auth";
import type { Profile, ProfileStore } from "./config";

export interface HaunterClient {
	call(name: string, args: Record<string, unknown>): Promise<unknown>;
	listTools(): Promise<Tool[]>;
	callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult>;
	close(): Promise<void>;
}

export async function connect(
	store: ProfileStore,
	profile: Profile,
	signal?: AbortSignal,
): Promise<HaunterClient> {
	if (!profile.tokens) throw new Error(LOGIN_REQUIRED);
	const client = new Client(
		{ name: "haunter-cli", version },
		{ capabilities: {} },
	);
	const transport = new StreamableHTTPClientTransport(new URL(store.server), {
		authProvider: new AuthProvider(store, profile),
		fetch: boundedFetch(signal),
		reconnectionOptions: {
			maxRetries: 0,
			initialReconnectionDelay: 1000,
			maxReconnectionDelay: 1000,
			reconnectionDelayGrowFactor: 1,
		},
	});
	try {
		await client.connect(transport, { timeout: 30_000, signal });
	} catch (error) {
		await client.close();
		throw error;
	}
	return {
		async listTools() {
			const tools: Tool[] = [];
			const names = new Set<string>();
			const cursors = new Set<string>();
			let cursor: string | undefined;
			for (let page = 0; page < 100; page++) {
				// Fetch every page without the SDK's per-page output-validator cache.
				// Generic calls validate only the selected tool's advertised schemas.
				const result = await client.request(
					{
						method: "tools/list",
						params: cursor === undefined ? {} : { cursor },
					},
					ListToolsResultSchema,
					{ timeout: 30_000, signal },
				);
				for (const tool of result.tools) {
					if (names.has(tool.name))
						throw new Error(`Haunter listed duplicate tool ${tool.name}.`);
					names.add(tool.name);
					tools.push(tool);
				}
				cursor = result.nextCursor;
				if (cursor === undefined) return tools;
				if (cursors.has(cursor))
					throw new Error("Haunter repeated a tool-list cursor.");
				cursors.add(cursor);
			}
			throw new Error("Haunter's tool list exceeded 100 pages.");
		},
		callTool: (name, args) =>
			client.request(
				{ method: "tools/call", params: { name, arguments: args } },
				CallToolResultSchema,
				{ timeout: 30_000, signal },
			),
		async call(name, args) {
			// Do not retry mutations: a timed-out request may already have committed.
			const result = await client.callTool(
				{ name, arguments: args },
				undefined,
				{ timeout: 30_000, signal },
			);
			const text = Array.isArray(result.content)
				? result.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n")
				: "";
			if (result.isError)
				throw new Error(text || `Haunter could not complete ${name}.`);
			if (result.structuredContent) return result.structuredContent;
			try {
				return JSON.parse(text);
			} catch {
				throw new Error(`Haunter returned an unexpected response for ${name}.`);
			}
		},
		close: () => client.close(),
	};
}
