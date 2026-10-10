import { expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import type { TLPageId, TLShapeId } from "tldraw";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { normalizeCanvasSnapshot } from "../lib/document";

test("shared drawings fit mobile, resized, and switched pages without resetting manual navigation", async () => {
	installTestDom();
	const { Editor, createTLStore, defaultShapeUtils, defaultBindingUtils } =
		await import("tldraw");
	const { fitSharedCanvas } = await import("../client/fit-shared-canvas");
	const container = document.createElement("div");
	document.body.append(container);
	let width = 358;
	let height = 442;
	container.getBoundingClientRect = () => new DOMRect(16, 100, width, height);
	const editor = new Editor({
		store: createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
			snapshot: normalizeCanvasSnapshot({}),
		}),
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => container,
	});
	const OriginalResizeObserver = globalThis.ResizeObserver;
	let resize = () => {};
	let disconnected = false;
	globalThis.ResizeObserver = class extends OriginalResizeObserver {
		constructor(callback: ResizeObserverCallback) {
			super(callback);
			resize = () => callback([], this);
		}
		disconnect() {
			disconnected = true;
			super.disconnect();
		}
	};
	let stop = () => {};
	try {
		const shapeId = "shape:drawing" as TLShapeId;
		const firstPage = editor.getCurrentPageId();
		const secondPage = "page:other" as TLPageId;
		editor.createShape({
			id: shapeId,
			type: "geo",
			x: 1200,
			y: 800,
			props: { w: 720, h: 400 },
		});
		editor.createPage({ id: secondPage, name: "Other" });
		editor.setCurrentPage(secondPage);
		const otherShapeId = "shape:other" as TLShapeId;
		editor.createShape({ id: otherShapeId, type: "geo", x: -1600, y: -900 });
		editor.setCurrentPage(firstPage);
		editor.updateInstanceState({ isReadonly: true });
		const documentBefore = editor.store.getStoreSnapshot();
		stop = fitSharedCanvas(editor);

		function expectVisible(id: TLShapeId) {
			const viewport = editor.getViewportPageBounds();
			const shape = editor.getShapePageBounds(id)!;
			expect(viewport.minX).toBeLessThan(shape.minX);
			expect(viewport.minY).toBeLessThan(shape.minY);
			expect(viewport.maxX).toBeGreaterThan(shape.maxX);
			expect(viewport.maxY).toBeGreaterThan(shape.maxY);
		}
		await waitFor(() => expectVisible(shapeId));
		const mobileZoom = editor.getZoomLevel();
		width = 1100;
		height = 700;
		resize();
		await waitFor(() =>
			expect(editor.getZoomLevel()).toBeGreaterThan(mobileZoom),
		);
		expectVisible(shapeId);
		width = 288;
		height = 442;
		resize();
		await waitFor(() => {
			expect(editor.getViewportScreenBounds().width).toBe(width);
			expectVisible(shapeId);
		});

		editor.setCamera({ x: 10, y: 20, z: 2 }, { immediate: true });
		const manualCamera = editor.getCamera();
		resize(); // Same size: do not interfere with the reader's navigation.
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
		expect(editor.getCamera()).toEqual(manualCamera);
		editor.setCurrentPage(secondPage);
		await waitFor(() => expectVisible(otherShapeId));
		expect(editor.store.getStoreSnapshot()).toEqual(documentBefore);
		stop();
		expect(disconnected).toBe(true);
		editor.setCurrentPage(firstPage);
		const stoppedCamera = editor.getCamera();
		await new Promise(requestAnimationFrame);
		expect(editor.getCamera()).toEqual(stoppedCamera);
	} finally {
		stop();
		globalThis.ResizeObserver = OriginalResizeObserver;
		editor.dispose();
		container.remove();
		await uninstallTestDom();
	}
});
