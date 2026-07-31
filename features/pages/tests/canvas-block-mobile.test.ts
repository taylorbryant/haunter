import { describe, expect, test } from "bun:test";

describe("fullscreen canvas chrome", () => {
	test("uses a consistent header close action at every viewport size", async () => {
		const source = await Bun.file(
			new URL("../components/editor/canvas-block.tsx", import.meta.url),
		).text();
		const canvasSurfaceSource = await Bun.file(
			new URL("../../canvases/components/canvas-surface.tsx", import.meta.url),
		).text();

		expect(source).toContain(
			"h-dvh w-screen overflow-hidden rounded-none border-0 bg-background shadow-none",
		);
		expect(source).toContain(
			'aria-label={expanded ? "Close canvas" : "Expand canvas"}',
		);
		expect(source).toContain('aria-live="polite"');
		expect(source).toContain('{saveState === "saving" ? "Saving…" : null}');
		expect(source).toContain('<XIcon className="size-4" />');
		expect(source).toContain("onClick={(event) => event.stopPropagation()}");
		expect(source).not.toContain('expanded && "md:hidden"');
		expect(source).not.toContain('expanded ? "hidden md:flex" : "hidden"');
		expect(source).not.toContain('<XIcon className="size-5" />');
		expect(source).not.toContain(".inert = true");
		expect(canvasSurfaceSource).not.toContain("Saving…");
	});
});
