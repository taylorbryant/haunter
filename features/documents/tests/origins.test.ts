import { expect, test } from "bun:test";
import {
	HocuspocusProvider,
	HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";
import { CollaborationOrigins } from "@/lib/collaboration-origins";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { checkDocumentAccess } from "@/infra/documents/access";
import { pageDocumentName } from "../model";
import { documentFixture } from "./helpers";

// The app includes DOM types, which omit Bun's constructor header option.
const BunWebSocket = WebSocket as unknown as {
	new (url: string, options?: import("bun").WebSocketOptions): WebSocket;
};

test("additional collaboration origins require exact browser origins", () => {
	expect(
		CollaborationOrigins.parse(
			" https://preview.example.com/, http://localhost:3000 ",
		),
	).toEqual(["https://preview.example.com", "http://localhost:3000"]);
	for (const value of [
		"",
		"*",
		"https://*.vercel.app",
		"null",
		"wss://preview.example.com",
		"https://preview.example.com/page",
		"https://preview.example.com?query=1",
		"https://preview.example.com#hash",
		"https://user:password@preview.example.com",
	])
		expect(CollaborationOrigins.safeParse(value).success).toBe(false);
});

test("canonical and explicit preview origins sync while other origins and invalid tokens are rejected", async () => {
	const f = await documentFixture();
	const origins = {
		origin: "https://www.haunter.app",
		additionalOrigins: CollaborationOrigins.parse(
			"https://preview.example.com",
		),
	};
	const tokens = createDocumentSessionTokens(
		"origin-test-secret-at-least-32-characters",
	);
	const engine = createDocumentServer({
		...origins,
		verify: tokens.verify,
		async authorize(grant) {
			return {
				ctx: f.ctx,
				role: await checkDocumentAccess(grant, f.database.db),
			};
		},
	});
	const transport = listenDocumentServer(engine, {
		...origins,
		hostname: "127.0.0.1",
		port: 0,
	});
	const providers: HocuspocusProvider[] = [];
	const sockets: HocuspocusProviderWebsocket[] = [];
	const docs: Y.Doc[] = [];
	try {
		for (const origin of [origins.origin, ...origins.additionalOrigins]) {
			for (const validToken of [true, false]) {
				const document = new Y.Doc();
				docs.push(document);
				let rejected = false;
				const websocketProvider = new HocuspocusProviderWebsocket({
					url: `ws://127.0.0.1:${transport.port}`,
					WebSocketPolyfill: class extends BunWebSocket {
						constructor(url: string) {
							super(url, { headers: { origin } });
						}
					},
				});
				sockets.push(websocketProvider);
				const provider = new HocuspocusProvider({
					websocketProvider,
					name: pageDocumentName(f.workspaceId, f.page.id),
					token: validToken ? tokens.issue(f.grant).token : "invalid-token",
					document,
					onAuthenticationFailed: () => {
						rejected = true;
					},
				});
				providers.push(provider);
				provider.attach();
				const deadline = Date.now() + 3000;
				while (!provider.isSynced && !rejected && Date.now() < deadline)
					await new Promise((resolve) => setTimeout(resolve, 10));
				expect(provider.isSynced).toBe(validToken);
				expect(rejected).toBe(!validToken);
			}
		}
		for (const origin of [
			"https://untrusted.vercel.app",
			"https://preview.example.com.evil.test",
			"null",
			"",
		]) {
			for (const path of ["/", "/canvas/example"]) {
				const response = await fetch(
					`http://127.0.0.1:${transport.port}${path}`,
					{
						headers: {
							origin,
							Upgrade: "websocket",
							Connection: "Upgrade",
							"Sec-WebSocket-Version": "13",
							"Sec-WebSocket-Key": "SGF1bnRlck9yaWdpblRlcw==",
						},
					},
				);
				expect(response.status).toBe(403);
				expect(await response.text()).toBe("Forbidden");
			}
		}
	} finally {
		providers.forEach((provider) => provider.destroy());
		sockets.forEach((socket) => socket.destroy());
		await stopDocumentServer(engine);
		await transport.stop(true);
		docs.forEach((doc) => doc.destroy());
		await f.database.close();
	}
}, 15_000);
