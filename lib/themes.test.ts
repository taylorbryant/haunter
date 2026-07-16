import { describe, expect, test } from "bun:test";
import {
	APP_THEME_IDS,
	getResolvedThemeColor,
	getResolvedThemeColorScheme,
	THEME_OPTIONS,
} from "./themes";

describe("app themes", () => {
	test("registers Dracula as a selectable app theme", () => {
		expect(APP_THEME_IDS).toEqual(["light", "dark", "dracula"]);
		expect(THEME_OPTIONS.map((theme) => theme.id)).toEqual([
			"system",
			"light",
			"dark",
			"dracula",
		]);
	});

	test("scopes palette variables to the document root", async () => {
		const css = await Bun.file(
			new URL("../app/globals.css", import.meta.url),
		).text();

		expect(css).toContain(":root.dark {");
		expect(css).toContain(":root.dracula {");
		expect(css).not.toMatch(/(^|\n)\.(dark|dracula)\s*\{/);
	});

	test("treats Dracula as dark for embedded surfaces", () => {
		expect(getResolvedThemeColorScheme("dracula")).toBe("dark");
		expect(getResolvedThemeColor("dracula")).toBe("#282a36");
	});

	test("falls back safely while the theme is unresolved", () => {
		expect(getResolvedThemeColorScheme(undefined)).toBe("light");
		expect(getResolvedThemeColor(undefined)).toBeUndefined();
	});
});
