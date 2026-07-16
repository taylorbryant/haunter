"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { type ComponentProps, useEffect } from "react";
import { APP_THEME_IDS, getResolvedThemeColor } from "@/lib/themes";

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
	...props
}: ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider {...props} themes={APP_THEME_IDS}>
			<ThemeColorSync />
			{children}
		</NextThemesProvider>
	);
}
