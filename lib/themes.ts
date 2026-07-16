export const APP_THEMES = [
	{
		id: "light",
		label: "Light",
		colorScheme: "light",
		themeColor: "#ffffff",
		preview: { background: "#ffffff", foreground: "#171717" },
	},
	{
		id: "dark",
		label: "Dark",
		colorScheme: "dark",
		themeColor: "#0a0a0a",
		preview: { background: "#0a0a0a", foreground: "#fafafa" },
	},
	{
		id: "dracula",
		label: "Dracula",
		colorScheme: "dark",
		themeColor: "#282a36",
		preview: { background: "#282a36", foreground: "#ff79c6" },
	},
	{
		id: "catppuccin",
		label: "Catppuccin",
		colorScheme: "dark",
		themeColor: "#1e1e2e",
		preview: { background: "#1e1e2e", foreground: "#cba6f7" },
	},
	{
		id: "gruvbox",
		label: "Gruvbox",
		colorScheme: "dark",
		themeColor: "#282828",
		preview: { background: "#282828", foreground: "#fe8019" },
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		colorScheme: "dark",
		themeColor: "#1a1b26",
		preview: { background: "#1a1b26", foreground: "#7aa2f7" },
	},
	{
		id: "nord",
		label: "Nord",
		colorScheme: "dark",
		themeColor: "#2e3440",
		preview: { background: "#2e3440", foreground: "#88c0d0" },
	},
	{
		id: "rose-pine",
		label: "Rosé Pine",
		colorScheme: "dark",
		themeColor: "#191724",
		preview: { background: "#191724", foreground: "#eb6f92" },
	},
	{
		id: "everforest",
		label: "Everforest",
		colorScheme: "dark",
		themeColor: "#2d353b",
		preview: { background: "#2d353b", foreground: "#a7c080" },
	},
	{
		id: "solarized",
		label: "Solarized",
		colorScheme: "dark",
		themeColor: "#002b36",
		preview: { background: "#002b36", foreground: "#2aa198" },
	},
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]["id"];
export type ThemePreference = AppThemeId | "system";
export type ThemeColorScheme = (typeof APP_THEMES)[number]["colorScheme"];

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
