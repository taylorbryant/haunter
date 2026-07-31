import { describe, expect, test } from "bun:test";

describe("fullscreen canvas chrome", () => {
	test("uses a consistent header close action at every viewport size", async () => {
		const source = await Bun.file(
			new URL("../components/editor/canvas-block.tsx", import.meta.url),
		).text();
		const canvasSurfaceSource = await Bun.file(
			new URL("../../canvases/components/canvas-surface.tsx", import.meta.url),
		).text();
		const tldrawWrapperSource = await Bun.file(
			new URL(
				"../../canvases/components/tldraw-with-fonts.tsx",
				import.meta.url,
			),
		).text();

		expect(source).toContain(
			"h-dvh w-screen overflow-hidden rounded-none border-0 bg-background shadow-none",
		);
		expect(source).not.toContain('expanded && "overflow-hidden rounded-lg"');
		expect(source).toContain(
			'aria-label={expanded ? "Close canvas" : "Expand canvas"}',
		);
		expect(source).toContain('aria-live="polite"');
		expect(source).toContain('{saveState === "saving" ? "Saving…" : null}');
		expect(source).toContain('<XIcon className="size-4" />');
		expect(source).toContain("onClick={(event) => event.stopPropagation()}");
		expect(source).not.toContain(
			"onKeyDown={(event) => event.stopPropagation()}",
		);
		expect(source).toContain("if (event.defaultPrevented) return;");
		expect(source).not.toContain('expanded && "md:hidden"');
		expect(source).not.toContain('expanded ? "hidden md:flex" : "hidden"');
		expect(source).not.toContain('<XIcon className="size-5" />');
		expect(source).not.toContain(".inert = true");
		expect(source).toContain('layoutKey={expanded ? "fullscreen" : "inline"}');
		expect(tldrawWrapperSource).toContain(
			"editor.updateViewportScreenBounds(container)",
		);
		expect(tldrawWrapperSource).toContain("autoFocus={false}");
		expect(tldrawWrapperSource).toContain(
			'ownerDocument.addEventListener(\n\t\t\t"pointerdown",\n\t\t\thandleDocumentPointerDown,\n\t\t\ttrue',
		);
		expect(tldrawWrapperSource).toContain(
			"if (container.contains(target)) editor.focus();",
		);
		expect(canvasSurfaceSource).not.toContain("Saving…");
	});
});
