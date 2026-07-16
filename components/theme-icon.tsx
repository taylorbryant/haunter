import { MonitorIcon, MoonIcon, SparklesIcon, SunIcon } from "lucide-react";
import type { ComponentProps } from "react";
import type { ThemePreference } from "@/lib/themes";

const THEME_ICONS = {
	system: MonitorIcon,
	light: SunIcon,
	dark: MoonIcon,
	dracula: SparklesIcon,
} satisfies Record<ThemePreference, typeof SunIcon>;

export function ThemeIcon({
	theme,
	...props
}: ComponentProps<typeof SunIcon> & { theme: ThemePreference }) {
	const Icon = THEME_ICONS[theme];
	return <Icon {...props} />;
}
