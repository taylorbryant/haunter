export const APP_THEMES = [
	{
		id: "light",
		label: "Light",
		colorScheme: "light",
		themeColor: "#ffffff",
		preview: { background: "#ffffff", foreground: "#171717" },
		syntaxTheme: {
			id: "github-light",
			background: "#ffffff",
			foreground: "#24292e",
		},
	},
	{
		id: "dark",
		label: "Dark",
		colorScheme: "dark",
		themeColor: "#0a0a0a",
		preview: { background: "#0a0a0a", foreground: "#fafafa" },
		syntaxTheme: {
			id: "github-dark",
			background: "#24292e",
			foreground: "#e1e4e8",
		},
	},
	{
		id: "dracula",
		label: "Dracula",
		colorScheme: "dark",
		themeColor: "#282a36",
		preview: { background: "#282a36", foreground: "#ff79c6" },
		syntaxTheme: {
			id: "dracula",
			background: "#282a36",
			foreground: "#f8f8f2",
		},
	},
	{
		id: "catppuccin",
		label: "Catppuccin",
		colorScheme: "dark",
		themeColor: "#1e1e2e",
		preview: { background: "#1e1e2e", foreground: "#cba6f7" },
		syntaxTheme: {
			id: "catppuccin-mocha",
			background: "#1e1e2e",
			foreground: "#cdd6f4",
		},
	},
	{
		id: "gruvbox",
		label: "Gruvbox",
		colorScheme: "dark",
		themeColor: "#282828",
		preview: { background: "#282828", foreground: "#fe8019" },
		syntaxTheme: {
			id: "gruvbox-dark-medium",
			background: "#282828",
			foreground: "#ebdbb2",
		},
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		colorScheme: "dark",
		themeColor: "#1a1b26",
		preview: { background: "#1a1b26", foreground: "#7aa2f7" },
		syntaxTheme: {
			id: "tokyo-night",
			background: "#1a1b26",
			foreground: "#a9b1d6",
		},
	},
	{
		id: "nord",
		label: "Nord",
		colorScheme: "dark",
		themeColor: "#2e3440",
		preview: { background: "#2e3440", foreground: "#88c0d0" },
		syntaxTheme: {
			id: "nord",
			background: "#2e3440",
			foreground: "#d8dee9",
		},
	},
	{
		id: "rose-pine",
		label: "Rosé Pine",
		colorScheme: "dark",
		themeColor: "#191724",
		preview: { background: "#191724", foreground: "#eb6f92" },
		syntaxTheme: {
			id: "rose-pine",
			background: "#191724",
			foreground: "#e0def4",
		},
	},
	{
		id: "everforest",
		label: "Everforest",
		colorScheme: "dark",
		themeColor: "#2d353b",
		preview: { background: "#2d353b", foreground: "#a7c080" },
		syntaxTheme: {
			id: "everforest-dark",
			background: "#2d353b",
			foreground: "#d3c6aa",
		},
	},
	{
		id: "solarized",
		label: "Solarized",
		colorScheme: "dark",
		themeColor: "#002b36",
		preview: { background: "#002b36", foreground: "#2aa198" },
		syntaxTheme: {
			id: "solarized-dark",
			background: "#002b36",
			foreground: "#839496",
		},
	},
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]["id"];
export type ThemePreference = AppThemeId | "system";
export type ThemeColorScheme = (typeof APP_THEMES)[number]["colorScheme"];
export type SyntaxThemeId = (typeof APP_THEMES)[number]["syntaxTheme"]["id"];

export const APP_THEME_IDS: AppThemeId[] = APP_THEMES.map((theme) => theme.id);

export const THEME_OPTIONS = [
	{ id: "system", label: "System" },
	...APP_THEMES.map(({ id, label }) => ({ id, label })),
] satisfies Array<{ id: ThemePreference; label: string }>;

export function getAppTheme(theme: string | undefined) {
	return APP_THEMES.find((candidate) => candidate.id === theme);
}

export function getResolvedThemeColorScheme(
	resolvedTheme: string | undefined,
): ThemeColorScheme {
	return getAppTheme(resolvedTheme)?.colorScheme ?? "light";
}

export function getResolvedThemeColor(
	resolvedTheme: string | undefined,
): string | undefined {
	return getAppTheme(resolvedTheme)?.themeColor;
}

export function getResolvedSyntaxTheme(resolvedTheme: string | undefined) {
	return getAppTheme(resolvedTheme)?.syntaxTheme ?? APP_THEMES[0].syntaxTheme;
}
