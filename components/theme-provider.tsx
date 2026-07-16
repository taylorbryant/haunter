"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	APP_THEME_IDS,
	DARK_APP_THEMES,
	type DarkThemeId,
	DEFAULT_THEME_PREFERENCES,
	getResolvedThemeColor,
	LIGHT_APP_THEMES,
	type LightThemeId,
	parseThemePreferences,
	resolveThemePreference,
	THEME_STORAGE_KEYS,
	type ThemeMode,
	type ThemePreferences,
} from "@/lib/themes";

type ThemePreferencesContextValue = ThemePreferences & {
	setMode: (mode: ThemeMode) => void;
	setLightTheme: (theme: LightThemeId) => void;
	setDarkTheme: (theme: DarkThemeId) => void;
};

const ThemePreferencesContext =
	createContext<ThemePreferencesContextValue | null>(null);

function getThemeBootstrapScript(storageKey: string) {
	const config = JSON.stringify({
		storageKey,
		keys: THEME_STORAGE_KEYS,
		lightThemes: LIGHT_APP_THEMES.map((theme) => theme.id),
		darkThemes: DARK_APP_THEMES.map((theme) => theme.id),
		defaults: DEFAULT_THEME_PREFERENCES,
	});

	return `(()=>{try{const c=${config};const legacy=localStorage.getItem(c.storageKey);const storedMode=localStorage.getItem(c.keys.mode);const mode=["system","light","dark"].includes(storedMode)?storedMode:legacy==="system"?"system":c.lightThemes.includes(legacy)?"light":c.darkThemes.includes(legacy)?"dark":c.defaults.mode;const storedLight=localStorage.getItem(c.keys.lightTheme);const storedDark=localStorage.getItem(c.keys.darkTheme);const light=c.lightThemes.includes(storedLight)?storedLight:c.lightThemes.includes(legacy)?legacy:c.defaults.lightTheme;const dark=c.darkThemes.includes(storedDark)?storedDark:c.darkThemes.includes(legacy)?legacy:c.defaults.darkTheme;localStorage.setItem(c.keys.mode,mode);localStorage.setItem(c.keys.lightTheme,light);localStorage.setItem(c.keys.darkTheme,dark);const systemDark=window.matchMedia("(prefers-color-scheme: dark)").matches;const active=mode==="light"?light:mode==="dark"?dark:systemDark?dark:light;localStorage.setItem(c.storageKey,active)}catch{}})();`;
}

function ThemePreferencesSync({
	children,
	storageKey,
}: {
	children: ReactNode;
	storageKey: string;
}) {
	const { setTheme } = useTheme();
	const [preferences, setPreferences] = useState<ThemePreferences>(
		DEFAULT_THEME_PREFERENCES,
	);
	const [initialized, setInitialized] = useState(false);

	useEffect(() => {
		try {
			setPreferences(
				parseThemePreferences({
					mode: localStorage.getItem(THEME_STORAGE_KEYS.mode),
					lightTheme: localStorage.getItem(THEME_STORAGE_KEYS.lightTheme),
					darkTheme: localStorage.getItem(THEME_STORAGE_KEYS.darkTheme),
					legacyTheme: localStorage.getItem(storageKey),
				}),
			);
		} catch {
			// Defaults still provide a working theme when storage is unavailable.
		}
		setInitialized(true);
	}, [storageKey]);

	useEffect(() => {
		if (!initialized) return;

		try {
			localStorage.setItem(THEME_STORAGE_KEYS.mode, preferences.mode);
			localStorage.setItem(
				THEME_STORAGE_KEYS.lightTheme,
				preferences.lightTheme,
			);
			localStorage.setItem(THEME_STORAGE_KEYS.darkTheme, preferences.darkTheme);
		} catch {
			// The active in-memory theme still works when storage is unavailable.
		}

		const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
		const applyTheme = () => {
			setTheme(
				resolveThemePreference(
					preferences,
					systemPreference.matches ? "dark" : "light",
				),
			);
		};

		applyTheme();
		if (preferences.mode !== "system") return;

		systemPreference.addEventListener("change", applyTheme);
		return () => systemPreference.removeEventListener("change", applyTheme);
	}, [initialized, preferences, setTheme]);

	const setMode = useCallback((mode: ThemeMode) => {
		setPreferences((current) => ({ ...current, mode }));
	}, []);
	const setLightTheme = useCallback((lightTheme: LightThemeId) => {
		setPreferences((current) => ({ ...current, lightTheme }));
	}, []);
	const setDarkTheme = useCallback((darkTheme: DarkThemeId) => {
		setPreferences((current) => ({ ...current, darkTheme }));
	}, []);
	const value = useMemo(
		() => ({
			...preferences,
			setMode,
			setLightTheme,
			setDarkTheme,
		}),
		[preferences, setMode, setLightTheme, setDarkTheme],
	);

	return (
		<ThemePreferencesContext.Provider value={value}>
			{children}
		</ThemePreferencesContext.Provider>
	);
}

export function useThemePreferences() {
	const context = useContext(ThemePreferencesContext);
	if (!context) {
		throw new Error("useThemePreferences must be used within ThemeProvider");
	}
	return context;
}

function ThemeColorSync() {
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		const themeColor = getResolvedThemeColor(resolvedTheme);
		if (!themeColor) return;

		for (const meta of document.querySelectorAll<HTMLMetaElement>(
			'meta[name="theme-color"]',
		)) {
			meta.content = themeColor;
		}
	}, [resolvedTheme]);

	return null;
}

export function ThemeProvider({
	children,
	nonce,
	storageKey = "theme",
	...props
}: ComponentProps<typeof NextThemesProvider>) {
	return (
		<>
			<script
				nonce={nonce}
				suppressHydrationWarning
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Static bootstrap code prevents a theme flash before next-themes runs.
				dangerouslySetInnerHTML={{
					__html: getThemeBootstrapScript(storageKey),
				}}
			/>
			<NextThemesProvider
				{...props}
				nonce={nonce}
				storageKey={storageKey}
				themes={APP_THEME_IDS}
			>
				<ThemePreferencesSync storageKey={storageKey}>
					<ThemeColorSync />
					{children}
				</ThemePreferencesSync>
			</NextThemesProvider>
		</>
	);
}
