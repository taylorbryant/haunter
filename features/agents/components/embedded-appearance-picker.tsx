"use client";

import { useEffect } from "react";
import { useEmbeddedHostTheme } from "@/components/theme-provider";
import { APP_THEMES } from "@/lib/themes";
import { useEmbeddedAppearance } from "../client/embedded-appearance";
import { EmbeddedAppearanceSchema } from "../schemas";

export function EmbeddedAppearancePicker({
	hostTheme,
}: {
	hostTheme: "light" | "dark";
}) {
	const appearance = useEmbeddedAppearance();
	const setTheme = useEmbeddedHostTheme();
	useEffect(() => {
		setTheme?.(appearance.theme === "host" ? hostTheme : appearance.theme);
	}, [appearance.theme, hostTheme, setTheme]);
	return (
		<div className="px-2 text-xs text-muted-foreground">
			<label className="flex items-center gap-2">
				Appearance
				<select
					aria-label="Haunter theme"
					value={appearance.theme}
					disabled={appearance.loading || appearance.saving}
					onChange={(event) => {
						const parsed = EmbeddedAppearanceSchema.safeParse({
							theme: event.target.value,
						});
						if (parsed.success) appearance.change(parsed.data.theme);
					}}
					className="min-w-0 flex-1 rounded bg-sidebar py-2 text-foreground"
				>
					<option value="host">Follow host</option>
					{APP_THEMES.map((theme) => (
						<option key={theme.id} value={theme.id}>
							{theme.label}
						</option>
					))}
				</select>
			</label>
			{appearance.saving && <p role="status">Saving theme…</p>}
			{appearance.error && (
				<p role="alert">
					{appearance.error}{" "}
					<button
						type="button"
						className="underline"
						onClick={appearance.retry}
					>
						Retry
					</button>
				</p>
			)}
		</div>
	);
}
