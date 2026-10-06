import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { createEmbeddedEditorAuth } from "../client/embedded-editor-auth";

const desktopOrigin =
	"codex-sandbox://mcp-app-d957817f52436527f84905c788364e0b902d1034af7de3eb.web-sandbox.oaiusercontent.com";
beforeEach(installTestDom);
afterEach(uninstallTestDom);

test("workspace authorization reports a host tool failure without attempting exchange", async () => {
	window.history.replaceState(
		null,
		"",
		`/?${new URLSearchParams({
			parentOrigin: desktopOrigin,
			nonce: "workspace-nonce",
		})}`,
	);
	Object.defineProperty(window, "parent", {
		configurable: true,
		value: {
			postMessage(data: { type: string; requestId: string; nonce: string }) {
				expect(data.type).toBe("haunter/workspace/authorize");
				queueMicrotask(() =>
					window.dispatchEvent(
						new MessageEvent("message", {
							source: window.parent,
							origin: desktopOrigin,
							data: {
								...data,
								type: "haunter/editor/authorized",
								error: true,
								message: "Unknown tool: authorize_haunter_workspace",
							},
						}),
					),
				);
			},
		},
	});
	const exchange = spyOn(globalThis, "fetch");
	try {
		await expect(createEmbeddedEditorAuth("workspace").renew()).rejects.toThrow(
			"Haunter could not authorize the editor: Unknown tool: authorize_haunter_workspace",
		);
		expect(exchange).not.toHaveBeenCalled();
	} finally {
		exchange.mockRestore();
	}
});

test.each(["https://web-sandbox.oaiusercontent.com", desktopOrigin])(
	"authenticates via %s while rejecting mismatched host messages",
	async (origin) => {
		const nonce = "editor-nonce";
		window.history.replaceState(
			null,
			"",
			`/?${new URLSearchParams({ parentOrigin: origin, nonce })}`,
		);
		const request = Promise.withResolvers<{
			type: string;
			requestId: string;
			nonce: string;
			challenge: string;
		}>();
		const parent = {
			postMessage(data: Parameters<typeof request.resolve>[0], target: string) {
				expect(target).toBe(origin);
				request.resolve(data);
			},
		};
		Object.defineProperty(window, "parent", {
			configurable: true,
			value: parent,
		});
		const identity = {
			id: "51236b1b-4b5d-4f7b-a760-ff7dd4efb489",
			connectionId: "connection",
			workspaceId: "workspace",
			pageId: "17c05b44-c652-4d83-92cf-83cbf7056ef2",
			expiresAt: Date.now() + 60_000,
			role: "owner",
			user: {
				id: "user",
				name: "Taylor",
				email: "taylor@example.com",
				image: null,
			},
		};
		const exchange = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ token: "iframe-only-token", identity }),
		);
		try {
			const auth = createEmbeddedEditorAuth();
			const result = auth.renew();
			const challenge = await request.promise;
			expect(challenge.type).toBe("haunter/editor/authorize");
			expect(challenge.nonce).toBe(nonce);
			expect(challenge.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
			const data = {
				type: "haunter/editor/authorized",
				nonce,
				requestId: challenge.requestId,
				handoff: { id: "handoff-id" },
			};
			const emit = (overrides: Partial<MessageEventInit>) =>
				window.dispatchEvent(
					new MessageEvent("message", {
						source: window.parent,
						origin,
						data,
						...overrides,
					}),
				);
			for (const invalid of [
				{ origin: "https://unrelated.example" },
				{ origin: "null" },
				{ source: window },
				{ data: { ...data, nonce: "wrong-nonce" } },
				{ data: { ...data, requestId: "wrong-request" } },
			])
				emit(invalid);
			await Bun.sleep(0);
			expect(exchange).not.toHaveBeenCalled();
			emit({});
			expect(await result).toEqual(identity);
			expect(exchange).toHaveBeenCalledTimes(1);
			const [url, options] = exchange.mock.calls[0]!;
			expect(url).toBe("/api/embedded-editor/exchange");
			expect(options?.credentials).toBe("omit");
			const proof = JSON.parse(String(options?.body));
			expect(proof.id).toBe("handoff-id");
			expect(
				createHash("sha256").update(proof.proofSecret).digest("base64url"),
			).toBe(challenge.challenge);
			expect(challenge).not.toHaveProperty("proofSecret");
			expect(await auth.token()).toBe("iframe-only-token");
		} finally {
			exchange.mockRestore();
		}
	},
);
