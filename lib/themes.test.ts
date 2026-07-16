import { describe, expect, test } from "bun:test";
import {
	APP_THEME_IDS,
	APP_THEMES,
	getResolvedThemeColor,
	getResolvedThemeColorScheme,
	THEME_OPTIONS,
} from "./themes";

const REQUIRED_PALETTE_TOKENS = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
] as const;

describe("app themes", () => {
	test("registers every built-in palette as a selectable app theme", () => {
		expect(APP_THEME_IDS).toEqual([
			"light",
			"dark",
			"dracula",
			"catppuccin",
			"gruvbox",
			"tokyo-night",
			"nord",
			"rose-pine",
			"everforest",
			"solarized",
		]);
		expect(THEME_OPTIONS.map((theme) => theme.id)).toEqual([
			"system",
			...APP_THEME_IDS,
		]);
	});

	test("pairs every app palette with its matching syntax theme", () => {
		expect(
			Object.fromEntries(
				APP_THEMES.map((theme) => [theme.id, theme.syntaxTheme.id]),
			),
		).toEqual({
			light: "github-light",
			dark: "github-dark",
			dracula: "dracula",
			catppuccin: "catppuccin-mocha",
			gruvbox: "gruvbox-dark-medium",
			"tokyo-night": "tokyo-night",
			nord: "nord",
			"rose-pine": "rose-pine",
			everforest: "everforest-dark",
			solarized: "solarized-dark",
		});
	});

	test("scopes palette variables to the document root", async () => {
		const css = await Bun.file(
			new URL("../app/globals.css", import.meta.url),
		).text();

		for (const theme of APP_THEMES) {
			if (theme.colorScheme === "dark") {
				expect(css).toContain(`.${theme.id} *`);
			}
			expect(css).toContain(
				theme.id === "light" ? ":root {" : `:root.${theme.id} {`,
			);
		}
		expect(css).not.toMatch(
			/(^|\n)\.(dark|dracula|catppuccin|gruvbox|tokyo-night|nord|rose-pine|everforest|solarized)\s*\{/,
		);
	});

	test("defines a complete set of UI tokens for every palette", async () => {
		const css = await Bun.file(
			new URL("../app/globals.css", import.meta.url),
		).text();

		for (const theme of APP_THEMES) {
			const selector = theme.id === "light" ? ":root" : `:root.${theme.id}`;
			const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const block = css.match(
				new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\n\\}`),
			)?.[1];

			expect(block).toBeDefined();
			for (const token of REQUIRED_PALETTE_TOKENS) {
				expect(block).toContain(`--${token}:`);
			}
		}
	});

	test("treats named palettes as dark for embedded surfaces", () => {
		const namedPalettes = APP_THEMES.filter(
			(theme) => !["light", "dark"].includes(theme.id),
		);

		for (const theme of namedPalettes) {
			expect(getResolvedThemeColorScheme(theme.id)).toBe("dark");
			expect(getResolvedThemeColor(theme.id)).toBe(theme.themeColor);
		}
	});

	test("falls back safely while the theme is unresolved", () => {
		expect(getResolvedThemeColorScheme(undefined)).toBe("light");
		expect(getResolvedThemeColor(undefined)).toBeUndefined();
	});
});
