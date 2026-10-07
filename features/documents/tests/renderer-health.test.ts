import { expect, test } from "bun:test";
import { Hocuspocus } from "@hocuspocus/server";
import { listenDocumentServer } from "@/infra/documents/bun-transport";

test("renderer health can fail without taking live collaboration out of service", async () => {
	let rendererReady = false;
	let collaborationReady = true;
	const server = listenDocumentServer(new Hocuspocus(), {
		port: 0,
		hostname: "127.0.0.1",
		origin: "https://haunter.app",
		isReady: () => collaborationReady,
		rendererHealth: () => ({
			ready: rendererReady,
			state: rendererReady ? "ready" : "degraded",
		}),
	});
	try {
		const health = await fetch(new URL("/health", server.url));
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ ready: true });
		const failed = await fetch(new URL("/health/renderer", server.url));
		expect(failed.status).toBe(503);
		expect(failed.headers.get("cache-control")).toBe("no-store");
		expect(await failed.json()).toEqual({ ready: false, state: "degraded" });
		rendererReady = true;
		expect((await fetch(new URL("/health/renderer", server.url))).status).toBe(
			200,
		);
		collaborationReady = false;
		expect((await fetch(new URL("/health", server.url))).status).toBe(503);
	} finally {
		await server.stop(true);
	}
});
