import { MonitorIcon } from "lucide-react";
import { getAppTheme, type ThemePreference } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function ThemeIcon({
	theme,
	className,
}: {
	theme: ThemePreference;
	className?: string;
}) {
	const appTheme = getAppTheme(theme);

	if (!appTheme) {
		return (
			<span
				aria-hidden
				className={cn(
					"flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-muted-foreground",
					className,
				)}
			>
				<MonitorIcon className="size-3" />
			</span>
		);
	}

	return (
		<span
			aria-hidden
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-[5px] border font-semibold text-[9px] leading-none shadow-xs",
				className,
			)}
			style={{
				backgroundColor: appTheme.preview.background,
				borderColor: `color-mix(in srgb, ${appTheme.preview.foreground} 25%, ${appTheme.preview.background})`,
				color: appTheme.preview.foreground,
			}}
		>
			Aa
		</span>
	);
}
