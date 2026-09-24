// Bundled for an isolated Chromium page, never imported into the worker runtime.
import {
	Box,
	Editor,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	defaultAddFontsFromNode,
	tipTapDefaultExtensions,
	type TLPageId,
	type TLShapeId,
	type TLStoreSnapshot,
} from "tldraw";

export type BrowserPreviewInput = {
	snapshot: TLStoreSnapshot;
	pageId: string;
	shapeIds: string[];
	fontAssetUrls: Record<string, string>;
	licenseKey?: string;
};

export async function renderCanvasPreview(input: BrowserPreviewInput) {
	const container = document.createElement("div");
	container.className = "tl-container tl-theme__light";
	container.style.cssText = "position:fixed;width:1600px;height:1600px;";
	document.body.appendChild(container);
	const editor = new Editor({
		store: createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
			snapshot: input.snapshot,
		}),
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => container,
		fontAssetUrls: input.fontAssetUrls,
		licenseKey: input.licenseKey,
		options: {
			text: {
				tipTapConfig: { extensions: tipTapDefaultExtensions },
				addFontsFromNode: defaultAddFontsFromNode,
			},
		},
	});
	try {
		editor.setCurrentPage(input.pageId as TLPageId);
		await editor.fonts.loadRequiredFontsForCurrentPage();
		await document.fonts.ready;
		if ([...document.fonts].some((font) => font.status === "error"))
			throw new Error("Canvas fonts could not be loaded.");
		const ids = input.shapeIds as TLShapeId[];
		if (!ids.length) {
			const canvas = document.createElement("canvas");
			canvas.width = 640;
			canvas.height = 360;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Canvas rendering is unavailable.");
			ctx.fillStyle = "white";
			ctx.fillRect(0, 0, 640, 360);
			return {
				url: canvas.toDataURL("image/png"),
				width: 640,
				height: 360,
				bounds: { x: 0, y: 0, width: 640, height: 360 },
			};
		}
		const boxes = ids
			.map((id) => editor.getShapeMaskedPageBounds(id))
			.filter((box): box is Box => !!box);
		if (!boxes.length)
			return {
				error:
					"The selected shapes have no visible bounds. Select their containing frame or other shapes.",
			};
		const bounds = Box.Common(boxes).expandBy(32);
		if (
			![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) ||
			bounds.w <= 0 ||
			bounds.h <= 0
		)
			return { error: "The selected shapes have invalid canvas bounds." };
		// Extremely wide or tall drawings still need at least one output pixel on both axes.
		const minDimension = Math.max(bounds.w, bounds.h) / 1600;
		bounds.w = Math.max(bounds.w, minDimension);
		bounds.h = Math.max(bounds.h, minDimension);
		// tldraw 5.4 treats a single frame ID as an artboard, hiding its outline
		// and title. Repeating that ID bypasses the single-frame special case;
		// the exporter deduplicates rendering IDs, so the frame still draws once.
		const exportIds =
			ids.length === 1 && editor.isShapeOfType(ids[0], "frame")
				? [ids[0], ids[0]]
				: ids;
		const result = await editor.toImageDataUrl(exportIds, {
			format: "png",
			background: true,
			darkMode: false,
			bounds,
			padding: 0,
			scale: Math.min(1, 1600 / Math.max(bounds.w, bounds.h)),
			pixelRatio: 1,
		});
		return {
			...result,
			bounds: { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h },
		};
	} finally {
		editor.dispose();
		container.remove();
	}
}

Object.assign(window, { renderCanvasPreview });
