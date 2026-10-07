import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import {
	createCanvasBrowserRunner,
	type CanvasBrowserMetric,
} from "./browser-runtime";
import { createCanvasPreviewRenderer } from "./preview-renderer";
import { createCanvasStructureEditor } from "./structure-editor";
import { prepareCanvasEdit } from "./shape-edits";

/** One admission queue and lifecycle for every browser-backed canvas operation. */
export function createCanvasRenderingService(
	options: {
		licenseKey?: string;
		onMetric?: (metric: CanvasBrowserMetric) => void;
	} = {},
) {
	let verified = false;
	const runner = createCanvasBrowserRunner({
		onMetric(metric) {
			if (metric.outcome === "error" || metric.outcome === "timeout")
				verified = false;
			options.onMetric?.(metric);
		},
	});
	const preview = createCanvasPreviewRenderer({ ...options, runner });
	const structure = createCanvasStructureEditor({ ...options, runner });
	let warming: Promise<void> | undefined;
	return {
		preview,
		structure,
		health() {
			const health = runner.health();
			return {
				...health,
				ready: verified && !warming && health.ready,
				verified,
				warming: !!warming,
			};
		},
		warmup() {
			warming ??= (async () => {
				verified = false;
				const failures = runner.health().failed;
				// Exercise fonts, raster export, and native layout without a database or
				// a user document. Nothing produced here is persisted or broadcast.
				const canvasId = crypto.randomUUID();
				const drawing = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
					action: "edit",
					canvasId,
					expectedRevision: "startup",
					operations: [
						{
							op: "create",
							ref: "box",
							type: "rectangle",
							x: 0,
							y: 0,
							text: "Haunter",
						},
						{
							op: "create",
							ref: "note",
							type: "note",
							x: 300,
							y: 0,
							text: "Renderer ready",
						},
					],
				});
				const result = await structure.prepare({
					snapshot: drawing.next,
					command: {
						action: "edit",
						canvasId,
						expectedRevision: "startup",
						operations: [
							{
								op: "group",
								ref: "group",
								shapeIds: Object.values(drawing.createdShapes),
							},
						],
					},
				});
				if (!result.createdShapes.group)
					throw new Error("Canvas warmup did not create a group");
				const image = await preview.render({
					snapshot: result.next,
					command: { action: "preview", canvasId },
				});
				if (image.width < 1 || image.height < 1 || image.shapeIds.length < 2)
					throw new Error("Canvas warmup did not render the drawing");
				// User jobs can run between these two checks. A failure during either
				// part of verification requires a fresh, complete warmup.
				if (runner.health().failed !== failures)
					throw new Error("Canvas renderer failed during warmup");
				verified = true;
			})().finally(() => {
				warming = undefined;
			});
			return warming;
		},
		stop: runner.stop,
	};
}
