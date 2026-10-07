import { expect, test } from "bun:test";
import { createCanvasRenderingService } from "@/infra/canvases/rendering-service";
import {
	createCanvasBrowserRunner,
	type CanvasBrowserMetric,
} from "@/infra/canvases/browser-runtime";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { createCanvasStructureEditor } from "@/infra/canvases/structure-editor";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
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

type RenderingService = ReturnType<typeof createCanvasRenderingService>;

function failOperation(
	service: RenderingService,
	kind: CanvasBrowserMetric["kind"],
	error: Error,
) {
	if (kind === "preview")
		return service.preview.render({
			get snapshot(): never {
				throw error;
			},
			command: { action: "preview", canvasId: crypto.randomUUID() },
		});
	return service.structure.prepare({
		snapshot: normalizeCanvasSnapshot({}),
		// Structure input is serialized inside the admitted browser job.
		get command(): never {
			throw error;
		},
	});
}

async function successfulOperation(
	service: RenderingService,
	kind: CanvasBrowserMetric["kind"],
) {
	const canvasId = crypto.randomUUID();
	const drawing = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
		action: "edit",
		canvasId,
		expectedRevision: "fixture",
		operations: [
			{ op: "create", ref: "a", type: "rectangle", x: 0, y: 0 },
			{ op: "create", ref: "b", type: "rectangle", x: 300, y: 0 },
		],
	});
	if (kind === "preview")
		return service.preview.render({
			snapshot: drawing.next,
			command: { action: "preview", canvasId },
		});
	return service.structure.prepare({
		snapshot: drawing.next,
		command: {
			action: "edit",
			canvasId,
			expectedRevision: "fixture",
			operations: [
				{
					op: "group",
					ref: "group",
					shapeIds: Object.values(drawing.createdShapes),
				},
			],
		},
	});
}

for (const kind of ["preview", "structure"] as const) {
	for (const outcome of ["error", "timeout"] as const) {
		test(`${kind} ${outcome} requires both warmup checks before readiness recovers`, async () => {
			const metrics: CanvasBrowserMetric[] = [];
			const service = createCanvasRenderingService({
				onMetric: (metric) => metrics.push(metric),
			});
			try {
				await service.warmup();
				const error = new Error("Injected renderer failure");
				if (outcome === "timeout") error.name = "TimeoutError";
				await expect(failOperation(service, kind, error)).rejects.toBeDefined();
				expect(metrics.at(-1)).toMatchObject({ kind, outcome });
				expect(service.health()).toMatchObject({
					ready: false,
					verified: false,
				});

				await successfulOperation(
					service,
					kind === "preview" ? "structure" : "preview",
				);
				// The runner has recovered, but the failed capability has not been checked.
				expect(service.health()).toMatchObject({
					state: "ready",
					ready: false,
					verified: false,
					warming: false,
				});
				const recovery = service.warmup();
				expect(service.health()).toMatchObject({ ready: false, warming: true });
				await recovery;
				expect(
					metrics.slice(-2).map(({ kind, outcome }) => ({ kind, outcome })),
				).toEqual([
					{ kind: "structure", outcome: "ok" },
					{ kind: "preview", outcome: "ok" },
				]);
				expect(service.health()).toMatchObject({
					ready: true,
					verified: true,
					warming: false,
				});
			} finally {
				await service.stop();
			}
		}, 30_000);
	}
}

test("an interleaved renderer failure cannot be overwritten by warmup verification", async () => {
	let injectFailure = false;
	let failedJob: Promise<unknown> | undefined;
	const service = createCanvasRenderingService({
		onMetric(metric) {
			if (
				injectFailure &&
				metric.kind === "structure" &&
				metric.outcome === "ok"
			) {
				injectFailure = false;
				// Admission happens before warmup can enqueue its PNG check.
				failedJob = failOperation(
					service,
					"preview",
					new Error("Interleaved failure"),
				).catch((error) => error);
			}
		},
	});
	try {
		await service.warmup();
		injectFailure = true;
		const recovery = service.warmup();
		expect(service.health()).toMatchObject({
			ready: false,
			verified: false,
			warming: true,
		});
		await expect(recovery).rejects.toThrow(
			"Canvas renderer failed during warmup",
		);
		expect(failedJob).toBeDefined();
		await failedJob;
		expect(service.health()).toMatchObject({
			completed: 4,
			failed: 1,
			ready: false,
			verified: false,
			warming: false,
		});
		await service.warmup();
		expect(service.health()).toMatchObject({ ready: true, verified: true });
	} finally {
		await service.stop();
	}
}, 30_000);

test("invalid user input does not invalidate renderer verification", async () => {
	const metrics: CanvasBrowserMetric[] = [];
	const service = createCanvasRenderingService({
		onMetric: (metric) => metrics.push(metric),
	});
	try {
		await service.warmup();
		await expect(
			service.preview.render({
				snapshot: normalizeCanvasSnapshot({}),
				command: {
					action: "preview",
					canvasId: crypto.randomUUID(),
					shapeIds: ["shape:missing"],
				},
			}),
		).rejects.toBeDefined();
		expect(metrics.at(-1)?.outcome).toBe("invalid");
		expect(service.health()).toMatchObject({ ready: true, verified: true });
	} finally {
		await service.stop();
	}
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
