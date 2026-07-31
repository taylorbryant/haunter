import { describe, expect, test } from "bun:test";
import {
	createCanvasTheme,
	getCanvasThemePalette,
} from "@/features/canvases/lib/canvas-themes";
import { APP_THEMES } from "@/lib/themes";

describe("canvas themes", () => {
	test("provides a matching palette for every app theme", () => {
		for (const appTheme of APP_THEMES) {
			const palette = getCanvasThemePalette(appTheme.id);
			expect(palette.background).toBe(appTheme.themeColor);
			expect(palette.foreground).not.toBe(palette.background);
			expect(palette.accent).not.toBe(palette.background);
		}
	});

	test("applies the named palette to tldraw's active color scheme", () => {
		for (const appTheme of APP_THEMES) {
			const palette = getCanvasThemePalette(appTheme.id);
			const theme = createCanvasTheme(appTheme.id);
			const colors = theme.colors[appTheme.colorScheme];

			expect(colors.background).toBe(palette.background);
			expect(colors.text).toBe(palette.foreground);
			expect(colors.selectionStroke).toBe(palette.accent);
			expect(colors.red.solid).toBe(palette.red);
			expect(colors.orange.solid).toBe(palette.orange);
			expect(colors.yellow.solid).toBe(palette.yellow);
			expect(colors.green.solid).toBe(palette.green);
			expect(colors.blue.solid).toBe(palette.blue);
			expect(colors.violet.solid).toBe(palette.violet);
		}
	});

	test("falls back to the default light canvas theme", () => {
		expect(getCanvasThemePalette(undefined)).toEqual(
			getCanvasThemePalette("light"),
		);
		expect(createCanvasTheme("unknown").colors.light.background).toBe(
			getCanvasThemePalette("light").background,
		);
	});

	test("bridges tldraw UI variables to Haunter tokens", async () => {
		const css = await Bun.file(
			new URL("../../../app/globals.css", import.meta.url),
		).text();
		const block = css.match(
			/\.haunter-canvas \.tl-container \{([\s\S]*?)\n\}/,
		)?.[1];

		expect(block).toBeDefined();
		expect(block).toContain("--tl-color-background: var(--background);");
		expect(block).toContain("--tl-color-selection-stroke: var(--primary);");
		expect(block).toContain("--tl-color-panel: var(--popover);");
		expect(block).toContain("--tl-color-selected: var(--primary);");
		expect(block).toContain("--tl-color-text: var(--foreground);");
	});
});
