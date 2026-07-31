import {
	DEFAULT_THEME,
	type TLDefaultColor,
	type TLTheme,
	type TLThemeColors,
} from "tldraw";
import {
	APP_THEMES,
	type AppThemeId,
	getAppTheme,
	type ThemeColorScheme,
} from "@/lib/themes";

type CanvasThemePalette = {
	background: string;
	foreground: string;
	surface: string;
	mutedForeground: string;
	border: string;
	accent: string;
	accentForeground: string;
	red: string;
	orange: string;
	yellow: string;
	green: string;
	blue: string;
	violet: string;
};

const CANVAS_THEME_PALETTES = {
	light: {
		background: "#ffffff",
		foreground: "#171717",
		surface: "#ffffff",
		mutedForeground: "#737373",
		border: "#e5e5e5",
		accent: "#2563eb",
		accentForeground: "#ffffff",
		red: "#e03131",
		orange: "#f76707",
		yellow: "#f1ac4b",
		green: "#099268",
		blue: "#4465e9",
		violet: "#ae3ec9",
	},
	alucard: {
		background: "#fffbeb",
		foreground: "#1f1f1f",
		surface: "#efeddc",
		mutedForeground: "#6c664b",
		border: "#cfcfde",
		accent: "#644ac9",
		accentForeground: "#fffbeb",
		red: "#cb3a2a",
		orange: "#a34d14",
		yellow: "#846e15",
		green: "#14710a",
		blue: "#036a96",
		violet: "#644ac9",
	},
	"catppuccin-latte": {
		background: "#eff1f5",
		foreground: "#4c4f69",
		surface: "#e6e9ef",
		mutedForeground: "#6c6f85",
		border: "#bcc0cc",
		accent: "#8839ef",
		accentForeground: "#eff1f5",
		red: "#d20f39",
		orange: "#fe640b",
		yellow: "#df8e1d",
		green: "#40a02b",
		blue: "#1e66f5",
		violet: "#8839ef",
	},
	"rose-pine-dawn": {
		background: "#faf4ed",
		foreground: "#575279",
		surface: "#fffaf3",
		mutedForeground: "#797593",
		border: "#dfdad9",
		accent: "#907aa9",
		accentForeground: "#191724",
		red: "#b4637a",
		orange: "#d7827e",
		yellow: "#ea9d34",
		green: "#286983",
		blue: "#56949f",
		violet: "#907aa9",
	},
	"gruvbox-light": {
		background: "#fbf1c7",
		foreground: "#3c3836",
		surface: "#f9f5d7",
		mutedForeground: "#7c6f64",
		border: "#d5c4a1",
		accent: "#d65d0e",
		accentForeground: "#fbf1c7",
		red: "#cc241d",
		orange: "#d65d0e",
		yellow: "#d79921",
		green: "#98971a",
		blue: "#458588",
		violet: "#b16286",
	},
	"everforest-light": {
		background: "#fdf6e3",
		foreground: "#5c6a72",
		surface: "#f4f0d9",
		mutedForeground: "#829181",
		border: "#d3c6aa",
		accent: "#8da101",
		accentForeground: "#fdf6e3",
		red: "#f85552",
		orange: "#f57d26",
		yellow: "#dfa000",
		green: "#8da101",
		blue: "#3a94c5",
		violet: "#df69ba",
	},
	"solarized-light": {
		background: "#fdf6e3",
		foreground: "#657b83",
		surface: "#eee8d5",
		mutedForeground: "#839496",
		border: "#d3af86",
		accent: "#2aa198",
		accentForeground: "#fdf6e3",
		red: "#dc322f",
		orange: "#cb4b16",
		yellow: "#b58900",
		green: "#859900",
		blue: "#268bd2",
		violet: "#6c71c4",
	},
	dark: {
		background: "#0a0a0a",
		foreground: "#fafafa",
		surface: "#171717",
		mutedForeground: "#a3a3a3",
		border: "#292929",
		accent: "#3b82f6",
		accentForeground: "#ffffff",
		red: "#e03131",
		orange: "#f76707",
		yellow: "#ffc034",
		green: "#099268",
		blue: "#4f72fc",
		violet: "#ae3ec9",
	},
	dracula: {
		background: "#282a36",
		foreground: "#f8f8f2",
		surface: "#343746",
		mutedForeground: "#b7bad3",
		border: "#44475a",
		accent: "#bd93f9",
		accentForeground: "#282a36",
		red: "#ff5555",
		orange: "#ffb86c",
		yellow: "#f1fa8c",
		green: "#50fa7b",
		blue: "#8be9fd",
		violet: "#bd93f9",
	},
	catppuccin: {
		background: "#1e1e2e",
		foreground: "#cdd6f4",
		surface: "#313244",
		mutedForeground: "#a6adc8",
		border: "#45475a",
		accent: "#cba6f7",
		accentForeground: "#1e1e2e",
		red: "#f38ba8",
		orange: "#fab387",
		yellow: "#f9e2af",
		green: "#a6e3a1",
		blue: "#89b4fa",
		violet: "#cba6f7",
	},
	gruvbox: {
		background: "#282828",
		foreground: "#ebdbb2",
		surface: "#32302f",
		mutedForeground: "#a89984",
		border: "#504945",
		accent: "#fe8019",
		accentForeground: "#282828",
		red: "#fb4934",
		orange: "#fe8019",
		yellow: "#fabd2f",
		green: "#b8bb26",
		blue: "#83a598",
		violet: "#d3869b",
	},
	"tokyo-night": {
		background: "#1a1b26",
		foreground: "#c0caf5",
		surface: "#24283b",
		mutedForeground: "#a9b1d6",
		border: "#3b4261",
		accent: "#7aa2f7",
		accentForeground: "#1a1b26",
		red: "#f7768e",
		orange: "#ff9e64",
		yellow: "#e0af68",
		green: "#9ece6a",
		blue: "#7aa2f7",
		violet: "#bb9af7",
	},
	nord: {
		background: "#2e3440",
		foreground: "#eceff4",
		surface: "#3b4252",
		mutedForeground: "#b7c0d8",
		border: "#4c566a",
		accent: "#88c0d0",
		accentForeground: "#2e3440",
		red: "#bf616a",
		orange: "#d08770",
		yellow: "#ebcb8b",
		green: "#a3be8c",
		blue: "#81a1c1",
		violet: "#b48ead",
	},
	"rose-pine": {
		background: "#191724",
		foreground: "#e0def4",
		surface: "#1f1d2e",
		mutedForeground: "#908caa",
		border: "#403d52",
		accent: "#c4a7e7",
		accentForeground: "#191724",
		red: "#eb6f92",
		orange: "#ebbcba",
		yellow: "#f6c177",
		green: "#9ccfd8",
		blue: "#31748f",
		violet: "#c4a7e7",
	},
	everforest: {
		background: "#2d353b",
		foreground: "#d3c6aa",
		surface: "#343f44",
		mutedForeground: "#9da9a0",
		border: "#4f585e",
		accent: "#a7c080",
		accentForeground: "#2d353b",
		red: "#e67e80",
		orange: "#e69875",
		yellow: "#dbbc7f",
		green: "#a7c080",
		blue: "#7fbbb3",
		violet: "#d699b6",
	},
	solarized: {
		background: "#002b36",
		foreground: "#eee8d5",
		surface: "#073642",
		mutedForeground: "#93a1a1",
		border: "#586e75",
		accent: "#2aa198",
		accentForeground: "#002b36",
		red: "#dc322f",
		orange: "#cb4b16",
		yellow: "#b58900",
		green: "#859900",
		blue: "#268bd2",
		violet: "#6c71c4",
	},
} satisfies Record<AppThemeId, CanvasThemePalette>;

function mix(color: string, amount: number, target: string): string {
	return `color-mix(in srgb, ${color} ${amount}%, ${target})`;
}

function shapeColor(
	solid: string,
	palette: CanvasThemePalette,
	colorScheme: ThemeColorScheme,
): TLDefaultColor {
	const softTarget =
		colorScheme === "dark" ? palette.foreground : palette.background;

	return {
		solid,
		fill: solid,
		linedFill: mix(solid, 78, softTarget),
		frameHeadingStroke: solid,
		frameHeadingFill: mix(solid, 14, palette.surface),
		frameStroke: mix(solid, 68, palette.border),
		frameFill: mix(solid, 6, palette.background),
		frameText: palette.foreground,
		noteFill: mix(solid, 42, palette.surface),
		noteText: palette.foreground,
		semi: mix(solid, 18, palette.background),
		pattern: mix(solid, 72, palette.background),
		highlightSrgb: solid,
		highlightP3: solid,
	};
}

function colorsForPalette(
	palette: CanvasThemePalette,
	colorScheme: ThemeColorScheme,
): TLThemeColors {
	const base = DEFAULT_THEME.colors[colorScheme];
	const lightVariant = (color: string) =>
		mix(
			color,
			62,
			colorScheme === "dark" ? palette.foreground : palette.background,
		);

	return {
		...base,
		text: palette.foreground,
		background: palette.background,
		negativeSpace: palette.background,
		solid: palette.surface,
		cursor: palette.foreground,
		noteBorder: palette.border,
		snap: palette.red,
		selectionStroke: palette.accent,
		selectionFill: mix(palette.accent, 24, "transparent"),
		brushFill: mix(palette.mutedForeground, 14, "transparent"),
		brushStroke: mix(palette.mutedForeground, 32, "transparent"),
		selectedContrast: palette.accentForeground,
		laser: palette.red,
		black: shapeColor(palette.foreground, palette, colorScheme),
		grey: shapeColor(palette.mutedForeground, palette, colorScheme),
		"light-violet": shapeColor(
			lightVariant(palette.violet),
			palette,
			colorScheme,
		),
		violet: shapeColor(palette.violet, palette, colorScheme),
		blue: shapeColor(palette.blue, palette, colorScheme),
		"light-blue": shapeColor(lightVariant(palette.blue), palette, colorScheme),
		yellow: shapeColor(palette.yellow, palette, colorScheme),
		orange: shapeColor(palette.orange, palette, colorScheme),
		green: shapeColor(palette.green, palette, colorScheme),
		"light-green": shapeColor(
			lightVariant(palette.green),
			palette,
			colorScheme,
		),
		"light-red": shapeColor(lightVariant(palette.red), palette, colorScheme),
		red: shapeColor(palette.red, palette, colorScheme),
	};
}

export function getCanvasThemePalette(
	resolvedTheme: string | undefined,
): CanvasThemePalette {
	const appTheme = getAppTheme(resolvedTheme) ?? APP_THEMES[0];
	return CANVAS_THEME_PALETTES[appTheme.id];
}

export function createCanvasTheme(resolvedTheme: string | undefined): TLTheme {
	const appTheme = getAppTheme(resolvedTheme) ?? APP_THEMES[0];
	const palette = CANVAS_THEME_PALETTES[appTheme.id];
	const colors = colorsForPalette(palette, appTheme.colorScheme);

	return {
		...DEFAULT_THEME,
		colors: {
			...DEFAULT_THEME.colors,
			[appTheme.colorScheme]: colors,
		},
	};
}
