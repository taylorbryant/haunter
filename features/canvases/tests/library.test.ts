import { describe, expect, test } from "bun:test";
import type { TLGeoShapeProps } from "tldraw";
import {
	CANVAS_LIBRARY_ITEMS,
	getCanvasLibraryInsertionLayout,
	materializeCanvasLibraryItem,
	searchCanvasLibraryItems,
} from "@/features/canvases/lib/library";

describe("canvas library", () => {
	test("registers unique architecture and wireframe components and templates", () => {
		const ids = CANVAS_LIBRARY_ITEMS.map((entry) => entry.id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(
			CANVAS_LIBRARY_ITEMS.filter((entry) => entry.kind === "component"),
		).toHaveLength(22);
		expect(
			CANVAS_LIBRARY_ITEMS.filter((entry) => entry.kind === "template"),
		).toHaveLength(6);
		for (const entry of CANVAS_LIBRARY_ITEMS) {
			expect(entry.width).toBeGreaterThan(0);
			expect(entry.height).toBeGreaterThan(0);
			expect(entry.elements.length).toBeGreaterThan(0);
			expect(new Set(entry.elements.map((element) => element.key)).size).toBe(
				entry.elements.length,
			);
		}
	});

	test("searches names, categories, and keywords within the active section", () => {
		expect(
			searchCanvasLibraryItems("endpoint", "component").map(
				(entry) => entry.id,
			),
		).toEqual(["api-endpoint"]);
		expect(
			searchCanvasLibraryItems("mobile", "template").map((entry) => entry.id),
		).toEqual(["mobile-app-screen"]);
		expect(
			searchCanvasLibraryItems("architecture", "template").map(
				(entry) => entry.id,
			),
		).toEqual(["request-flow", "async-worker-flow", "state-change-map"]);
		expect(searchCanvasLibraryItems("", "component")).toHaveLength(22);
	});

	test("materializes standard tldraw records with semantic metadata", () => {
		for (const entry of CANVAS_LIBRARY_ITEMS) {
			const materialized = materializeCanvasLibraryItem(entry, {
				x: 120,
				y: 240,
				scale: 0.75,
			});
			const shapeIds = new Set(materialized.shapeIds);

			expect(materialized.shapes).toHaveLength(entry.elements.length);
			expect(shapeIds.size).toBe(entry.elements.length);
			expect(materialized.rootMeta).toEqual({
				haunterLibraryItemId: entry.id,
				haunterLibraryItemVersion: entry.version,
				haunterLibraryKind: entry.kind,
			});
			for (const shape of materialized.shapes) {
				expect(shapeIds.has(shape.id)).toBe(true);
				expect(shape.meta?.haunterLibraryItemId).toBe(entry.id);
				expect(shape.meta?.haunterLibraryItemVersion).toBe(entry.version);
				expect(shape.meta?.haunterLibraryRole).toBeString();
			}
			for (const binding of materialized.bindings) {
				expect(shapeIds.has(binding.fromId)).toBe(true);
				expect(shapeIds.has(binding.toId)).toBe(true);
			}
		}
	});

	test("scales geometry dimensions together with template positions", () => {
		const entry = CANVAS_LIBRARY_ITEMS.find(
			(item) => item.id === "request-flow",
		);
		expect(entry).toBeDefined();
		if (!entry) return;

		const scale = 0.5;
		const materialized = materializeCanvasLibraryItem(entry, {
			x: 100,
			y: 200,
			scale,
		});

		for (const [index, element] of entry.elements.entries()) {
			if (element.kind !== "geo") continue;
			const shape = materialized.shapes[index];
			expect(shape.type).toBe("geo");
			expect(shape.x).toBe(100 + element.x * scale);
			expect(shape.y).toBe(200 + element.y * scale);
			const props = shape.props as Partial<TLGeoShapeProps>;
			expect(props.w).toBe(element.width * scale);
			expect(props.h).toBe(element.height * scale);
			expect(props.scale).toBe(scale);
		}
	});

	test("gives bound architecture labels enough connector space", () => {
		const architectureTemplates = CANVAS_LIBRARY_ITEMS.filter(
			(entry) => entry.kind === "template" && entry.category === "architecture",
		);

		for (const entry of architectureTemplates) {
			const nodes = entry.elements.filter((element) => element.kind === "geo");
			for (const [index, node] of nodes.entries()) {
				for (const sibling of nodes.slice(index + 1)) {
					const overlaps =
						node.x < sibling.x + sibling.width &&
						node.x + node.width > sibling.x &&
						node.y < sibling.y + sibling.height &&
						node.y + node.height > sibling.y;
					expect(overlaps).toBe(false);
				}
			}

			for (const edge of entry.elements.filter(
				(element) => element.kind === "arrow",
			)) {
				expect(edge.kind).toBe("arrow");
				if (edge.kind !== "arrow") continue;
				if (!edge.label) continue;
				expect(edge.label.length).toBeLessThanOrEqual(8);

				const from = entry.elements.find(
					(element) => element.key === edge.from && element.kind === "geo",
				);
				const to = entry.elements.find(
					(element) => element.key === edge.to && element.kind === "geo",
				);
				expect(from?.kind).toBe("geo");
				expect(to?.kind).toBe("geo");
				if (from?.kind !== "geo" || to?.kind !== "geo") continue;

				const horizontalClearance = Math.max(
					to.x - (from.x + from.width),
					from.x - (to.x + to.width),
				);
				expect(horizontalClearance).toBeGreaterThanOrEqual(200);
			}
		}
	});

	test("uses comfortably sized actions in the form dialog template", () => {
		const formDialog = CANVAS_LIBRARY_ITEMS.find(
			(entry) => entry.id === "form-dialog-flow",
		);
		expect(formDialog).toBeDefined();
		if (!formDialog) return;

		for (const role of ["secondary-action", "primary-action"]) {
			const action = formDialog.elements.find(
				(element) => element.kind === "geo" && element.role === role,
			);
			expect(action?.kind).toBe("geo");
			if (action?.kind !== "geo") continue;
			expect(action.width).toBeGreaterThanOrEqual(100);
			expect(action.height).toBeGreaterThanOrEqual(40);
			expect(action.x + action.width).toBeLessThanOrEqual(formDialog.width);
			expect(action.y + action.height).toBeLessThanOrEqual(formDialog.height);
		}
	});

	test("keeps wireframe surfaces fixed instead of auto-growing for labels", () => {
		const wireframes = CANVAS_LIBRARY_ITEMS.filter(
			(entry) => entry.category === "wireframes",
		);

		for (const entry of wireframes) {
			for (const element of entry.elements) {
				if (element.kind !== "geo") continue;
				expect(element.label).toBeUndefined();
			}
		}
	});

	test("gives each tab label enough room to stay on one line", () => {
		const tabs = CANVAS_LIBRARY_ITEMS.find((entry) => entry.id === "tabs");
		expect(tabs).toBeDefined();
		if (!tabs) return;

		const labels = tabs.elements.filter(
			(element) => element.kind === "text" && element.role === "tab",
		);
		expect(labels).toHaveLength(3);
		for (const label of labels) {
			expect(label.kind).toBe("text");
			if (label.kind !== "text") continue;
			expect(label.width).toBeGreaterThanOrEqual(140);
			expect(label.x + label.width).toBeLessThanOrEqual(tabs.width);
		}
	});

	test("gives irregular architecture components generous label safe areas", () => {
		const expectedDimensions = {
			"external-system": { width: 340, height: 220 },
			decision: { width: 300, height: 240 },
			"system-boundary": { width: 380, height: 240 },
		};

		for (const [id, expected] of Object.entries(expectedDimensions)) {
			const entry = CANVAS_LIBRARY_ITEMS.find((item) => item.id === id);
			expect(entry).toBeDefined();
			if (!entry) continue;
			expect(entry.width).toBe(expected.width);
			expect(entry.height).toBe(expected.height);

			const title = entry.elements.find(
				(element) => element.kind === "text" && element.role === "label",
			);
			const subtitle = entry.elements.find(
				(element) => element.kind === "text" && element.role === "description",
			);
			expect(title?.kind).toBe("text");
			expect(subtitle?.kind).toBe("text");
			if (title?.kind !== "text" || subtitle?.kind !== "text") continue;
			expect(subtitle.y - title.y).toBeGreaterThanOrEqual(60);
			expect(title.x).toBeGreaterThanOrEqual(40);
			expect(title.x + title.width).toBeLessThanOrEqual(entry.width - 40);
			expect(subtitle.x + subtitle.width).toBeLessThanOrEqual(entry.width - 40);
		}
	});

	test("centers insertions in the visible canvas beside the desktop panel", () => {
		const layout = getCanvasLibraryInsertionLayout({
			viewport: { x: 0, y: 0, width: 1000, height: 600 },
			itemWidth: 224,
			itemHeight: 112,
			panelWidth: 320,
		});

		expect(layout).toEqual({
			scale: 1,
			center: { x: 660, y: 300 },
		});
	});

	test("fits large templates without enlarging small components", () => {
		const large = getCanvasLibraryInsertionLayout({
			viewport: { x: 0, y: 0, width: 1000, height: 600 },
			itemWidth: 1200,
			itemHeight: 900,
		});
		const small = getCanvasLibraryInsertionLayout({
			viewport: { x: 0, y: 0, width: 1000, height: 600 },
			itemWidth: 100,
			itemHeight: 100,
		});

		expect(large.scale).toBeCloseTo(0.5333, 3);
		expect(small.scale).toBe(1);
	});

	test("moves the library launcher past tldraw controls in desktop fullscreen", async () => {
		const [librarySource, surfaceSource] = await Promise.all([
			Bun.file(
				new URL("../components/canvas-library.tsx", import.meta.url),
			).text(),
			Bun.file(
				new URL("../components/canvas-surface.tsx", import.meta.url),
			).text(),
		]);

		expect(surfaceSource).toContain("data-canvas-layout={layoutKey}");
		expect(librarySource).toContain(
			"md:in-data-[canvas-layout=fullscreen]:left-80",
		);
	});
});
