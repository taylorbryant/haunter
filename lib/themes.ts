export const APP_THEMES = [
	{
		id: "light",
		label: "Light",
		colorScheme: "light",
		themeColor: "#ffffff",
	},
	{
		id: "dark",
		label: "Dark",
		colorScheme: "dark",
		themeColor: "#0a0a0a",
	},
	{
		id: "dracula",
		label: "Dracula",
		colorScheme: "dark",
		themeColor: "#282a36",
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

export function getResolvedThemeColorScheme(
	resolvedTheme: string | undefined,
): ThemeColorScheme {
	return (
		APP_THEMES.find((theme) => theme.id === resolvedTheme)?.colorScheme ??
		"light"
	);
}

export function getResolvedThemeColor(
	resolvedTheme: string | undefined,
): string | undefined {
	return APP_THEMES.find((theme) => theme.id === resolvedTheme)?.themeColor;
}
