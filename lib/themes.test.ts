import { describe, expect, test } from "bun:test";
import {
	APP_THEME_IDS,
	APP_THEMES,
	DARK_APP_THEMES,
	DEFAULT_THEME_PREFERENCES,
	getResolvedThemeColor,
	getResolvedThemeColorScheme,
	LIGHT_APP_THEMES,
	parseThemePreferences,
	resolveThemePreference,
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
	"code-block-background",
	"code-block-header-background",
	"code-block-foreground",
] as const;

describe("app themes", () => {
	test("registers every built-in palette in its appearance group", () => {
		expect(APP_THEME_IDS).toEqual([
			"light",
			"alucard",
			"catppuccin-latte",
			"rose-pine-dawn",
			"gruvbox-light",
			"everforest-light",
			"solarized-light",
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
		expect(LIGHT_APP_THEMES.map((theme) => theme.id)).toEqual([
			"light",
			"alucard",
			"catppuccin-latte",
			"rose-pine-dawn",
			"gruvbox-light",
			"everforest-light",
			"solarized-light",
		]);
		expect(DARK_APP_THEMES.map((theme) => theme.id)).toEqual([
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
	});

	test("migrates the previous single theme choice into mode preferences", () => {
		expect(parseThemePreferences({ legacyTheme: "dracula" })).toEqual({
			mode: "dark",
			lightTheme: "light",
			darkTheme: "dracula",
		});
		expect(parseThemePreferences({ legacyTheme: "system" })).toEqual(
			DEFAULT_THEME_PREFERENCES,
		);
		expect(
			parseThemePreferences({
				mode: "system",
				lightTheme: "light",
				darkTheme: "catppuccin",
				legacyTheme: "solarized",
			}),
		).toEqual({
			mode: "system",
			lightTheme: "light",
			darkTheme: "catppuccin",
		});
	});

	test("resolves system, light, and dark modes with independent palettes", () => {
		const preferences = {
			mode: "system",
			lightTheme: "light",
			darkTheme: "dracula",
		} as const;

		expect(resolveThemePreference(preferences, "light")).toBe("light");
		expect(resolveThemePreference(preferences, "dark")).toBe("dracula");
		expect(
			resolveThemePreference({ ...preferences, mode: "light" }, "dark"),
		).toBe("light");
		expect(
			resolveThemePreference({ ...preferences, mode: "dark" }, "light"),
		).toBe("dracula");
	});

	test("pairs every app palette with its matching syntax theme", () => {
		expect(
			Object.fromEntries(
				APP_THEMES.map((theme) => [theme.id, theme.syntaxTheme.id]),
			),
		).toEqual({
			light: "github-light",
			alucard: "alucard",
			"catppuccin-latte": "catppuccin-latte",
			"rose-pine-dawn": "rose-pine-dawn",
			"gruvbox-light": "gruvbox-light-medium",
			"everforest-light": "everforest-light",
			"solarized-light": "solarized-light",
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
			expect(block).toContain(
				`--code-block-background: ${theme.syntaxTheme.background};`,
			);
			expect(block).toContain(
				`--code-block-header-background: ${theme.syntaxTheme.headerBackground};`,
			);
			expect(block).toContain(
				`--code-block-foreground: ${theme.syntaxTheme.foreground};`,
			);
		}
	});

	test("reports the scheme and browser color for every palette", () => {
		for (const theme of APP_THEMES) {
			expect(getResolvedThemeColorScheme(theme.id)).toBe(theme.colorScheme);
			expect(getResolvedThemeColor(theme.id)).toBe(theme.themeColor);
		}
	});

	test("falls back safely while the theme is unresolved", () => {
		expect(getResolvedThemeColorScheme(undefined)).toBe("light");
		expect(getResolvedThemeColor(undefined)).toBeUndefined();
	});
});
