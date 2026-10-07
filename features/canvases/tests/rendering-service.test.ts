import { expect, test } from "bun:test";
import { createCanvasRenderingService } from "@/infra/canvases/rendering-service";
import { createCanvasBrowserRunner } from "@/infra/canvases/browser-runtime";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { createCanvasStructureEditor } from "@/infra/canvases/structure-editor";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import { appError } from "@/features/shared/errors";

test("startup health requires successful native grouping and PNG export", async () => {
	const service = createCanvasRenderingService();
	try {
		expect(service.health()).toMatchObject({
			ready: false,
			verified: false,
			warming: false,
		});
		const warmup = service.warmup();
		expect(service.warmup()).toBe(warmup);
		expect(service.health().warming).toBe(true);
		await warmup;
		expect(service.health()).toMatchObject({
			ready: true,
			verified: true,
			warming: false,
			completed: 2,
		});
	} finally {
		await service.stop();
	}
	expect(service.health().ready).toBe(false);
}, 30_000);

test("preview snapshot preparation waits behind layout work in the shared runner", async () => {
	let entered!: () => void;
	let release!: () => void;
	const started = new Promise<void>((r) => {
		entered = r;
	});
	const paused = new Promise<void>((r) => {
		release = r;
	});
	// Hold layout at the asset boundary, before a browser is launched.
	const runner = createCanvasBrowserRunner({
		assets: async () => {
			entered();
			await paused;
			throw appError("InvalidCanvasEdit", {
				message: "Fixture stops before browser launch",
			});
		},
	});
	const preview = createCanvasPreviewRenderer({ runner });
	const structure = createCanvasStructureEditor({ runner });
	const snapshot = normalizeCanvasSnapshot({});
	const layout = structure
		.prepare({
			snapshot,
			command: {
				action: "edit",
				canvasId: crypto.randomUUID(),
				expectedRevision: "fixture",
				operations: [],
			},
		})
		.catch((error) => error);
	await started;
	let prepared = false;
	const image = preview
		.render({
			get snapshot() {
				prepared = true;
				return snapshot;
			},
			command: { action: "preview", canvasId: crypto.randomUUID() },
		})
		.catch((error) => error);
	await Bun.sleep(10);
	expect(prepared).toBe(false);
	expect(runner.health().queued).toBe(1);
	release();
	await Promise.all([layout, image]);
	expect(prepared).toBe(true);
	await runner.stop();
});
