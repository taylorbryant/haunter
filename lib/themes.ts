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
			headerBackground: "#f6f8fa",
			foreground: "#24292e",
		},
	},
	{
		id: "alucard",
		label: "Alucard",
		colorScheme: "light",
		themeColor: "#fffbeb",
		preview: { background: "#fffbeb", foreground: "#644ac9" },
		syntaxTheme: {
			id: "alucard",
			background: "#fffbeb",
			headerBackground: "#dedccf",
			foreground: "#1f1f1f",
		},
	},
	{
		id: "catppuccin-latte",
		label: "Catppuccin Latte",
		colorScheme: "light",
		themeColor: "#eff1f5",
		preview: { background: "#eff1f5", foreground: "#8839ef" },
		syntaxTheme: {
			id: "catppuccin-latte",
			background: "#eff1f5",
			headerBackground: "#ccd0da",
			foreground: "#4c4f69",
		},
	},
	{
		id: "rose-pine-dawn",
		label: "Rosé Pine Dawn",
		colorScheme: "light",
		themeColor: "#faf4ed",
		preview: { background: "#faf4ed", foreground: "#b4637a" },
		syntaxTheme: {
			id: "rose-pine-dawn",
			background: "#faf4ed",
			headerBackground: "#f2e9e1",
			foreground: "#575279",
		},
	},
	{
		id: "gruvbox-light",
		label: "Gruvbox Light",
		colorScheme: "light",
		themeColor: "#fbf1c7",
		preview: { background: "#fbf1c7", foreground: "#d65d0e" },
		syntaxTheme: {
			id: "gruvbox-light-medium",
			background: "#fbf1c7",
			headerBackground: "#ebdbb2",
			foreground: "#3c3836",
		},
	},
	{
		id: "everforest-light",
		label: "Everforest Light",
		colorScheme: "light",
		themeColor: "#fdf6e3",
		preview: { background: "#fdf6e3", foreground: "#8da101" },
		syntaxTheme: {
			id: "everforest-light",
			background: "#fdf6e3",
			headerBackground: "#f4f0d9",
			foreground: "#5c6a72",
		},
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		colorScheme: "light",
		themeColor: "#fdf6e3",
		preview: { background: "#fdf6e3", foreground: "#2aa198" },
		syntaxTheme: {
			id: "solarized-light",
			background: "#fdf6e3",
			headerBackground: "#eee8d5",
			foreground: "#657b83",
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
			headerBackground: "#1b1f23",
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
			headerBackground: "#21222c",
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
			headerBackground: "#181825",
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
			headerBackground: "#1d2021",
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
			headerBackground: "#16161e",
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
			headerBackground: "#272c36",
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
			headerBackground: "#12101b",
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
			headerBackground: "#272e33",
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
			headerBackground: "#001f27",
			foreground: "#839496",
		},
	},
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]["id"];
type AppTheme = (typeof APP_THEMES)[number];
export type ThemeColorScheme = (typeof APP_THEMES)[number]["colorScheme"];
export type ThemeIdForColorScheme<T extends ThemeColorScheme> = Extract<
	AppTheme,
	{ colorScheme: T }
>["id"];
export type LightThemeId = ThemeIdForColorScheme<"light">;
export type DarkThemeId = ThemeIdForColorScheme<"dark">;
export type ThemeMode = "system" | ThemeColorScheme;
export type ThemePreference = AppThemeId | "system";
export type SyntaxThemeId = (typeof APP_THEMES)[number]["syntaxTheme"]["id"];

export const APP_THEME_IDS: AppThemeId[] = APP_THEMES.map((theme) => theme.id);
export const LIGHT_APP_THEMES = APP_THEMES.filter(
	(theme): theme is Extract<AppTheme, { colorScheme: "light" }> =>
		theme.colorScheme === "light",
);
export const DARK_APP_THEMES = APP_THEMES.filter(
	(theme): theme is Extract<AppTheme, { colorScheme: "dark" }> =>
		theme.colorScheme === "dark",
);

export const DEFAULT_LIGHT_THEME_ID = "light" satisfies LightThemeId;
export const DEFAULT_DARK_THEME_ID = "dark" satisfies DarkThemeId;

export const THEME_STORAGE_KEYS = {
	mode: "haunter-theme-mode",
	lightTheme: "haunter-light-theme",
	darkTheme: "haunter-dark-theme",
} as const;

export type ThemePreferences = {
	mode: ThemeMode;
	lightTheme: LightThemeId;
	darkTheme: DarkThemeId;
};

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
	mode: "system",
	lightTheme: DEFAULT_LIGHT_THEME_ID,
	darkTheme: DEFAULT_DARK_THEME_ID,
};

export function getAppTheme(theme: string | undefined) {
	return APP_THEMES.find((candidate) => candidate.id === theme);
}

export function getThemeIdForColorScheme(
	theme: string | null | undefined,
	colorScheme: "light",
): LightThemeId | undefined;
export function getThemeIdForColorScheme(
	theme: string | null | undefined,
	colorScheme: "dark",
): DarkThemeId | undefined;
export function getThemeIdForColorScheme(
	theme: string | null | undefined,
	colorScheme: ThemeColorScheme,
): AppThemeId | undefined {
	const appTheme = getAppTheme(theme ?? undefined);
	return appTheme?.colorScheme === colorScheme ? appTheme.id : undefined;
}

export function isThemeMode(
	value: string | null | undefined,
): value is ThemeMode {
	return value === "system" || value === "light" || value === "dark";
}

export function parseThemePreferences({
	mode,
	lightTheme,
	darkTheme,
	legacyTheme,
}: {
	mode?: string | null;
	lightTheme?: string | null;
	darkTheme?: string | null;
	legacyTheme?: string | null;
}): ThemePreferences {
	const legacyAppTheme = getAppTheme(legacyTheme ?? undefined);
	const migratedMode: ThemeMode =
		legacyTheme === "system"
			? "system"
			: (legacyAppTheme?.colorScheme ?? DEFAULT_THEME_PREFERENCES.mode);

	return {
		mode: isThemeMode(mode) ? mode : migratedMode,
		lightTheme:
			getThemeIdForColorScheme(lightTheme, "light") ??
			(legacyAppTheme?.colorScheme === "light"
				? legacyAppTheme.id
				: DEFAULT_LIGHT_THEME_ID),
		darkTheme:
			getThemeIdForColorScheme(darkTheme, "dark") ??
			(legacyAppTheme?.colorScheme === "dark"
				? legacyAppTheme.id
				: DEFAULT_DARK_THEME_ID),
	};
}

export function resolveThemePreference(
	preferences: ThemePreferences,
	systemColorScheme: ThemeColorScheme,
): AppThemeId {
	if (preferences.mode === "light") return preferences.lightTheme;
	if (preferences.mode === "dark") return preferences.darkTheme;
	return systemColorScheme === "dark"
		? preferences.darkTheme
		: preferences.lightTheme;
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
