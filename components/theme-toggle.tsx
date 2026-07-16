"use client";

import {
	CheckIcon,
	ChevronDownIcon,
	MonitorIcon,
	MoonIcon,
	SunIcon,
} from "lucide-react";
import { ThemeIcon } from "@/components/theme-icon";
import { useThemePreferences } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type AppThemeId,
	DARK_APP_THEMES,
	LIGHT_APP_THEMES,
	type ThemeMode,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

const MODE_OPTIONS = [
	{ id: "system", label: "System", icon: MonitorIcon },
	{ id: "light", label: "Light", icon: SunIcon },
	{ id: "dark", label: "Dark", icon: MoonIcon },
] as const satisfies ReadonlyArray<{
	id: ThemeMode;
	label: string;
	icon: typeof MonitorIcon;
}>;

function ThemeModePreview({ mode }: { mode: ThemeMode }) {
	return (
		<span
			aria-hidden
			className={cn(
				"relative block h-16 overflow-hidden",
				mode === "system" &&
					"bg-[linear-gradient(90deg,#e4e4e7_50%,#3f3f46_50%)]",
				mode === "light" && "bg-zinc-200",
				mode === "dark" && "bg-zinc-700",
			)}
		>
			<span
				className={cn(
					"absolute top-3 right-7 left-7 h-1.5 rounded-full",
					mode === "system" &&
						"bg-[linear-gradient(90deg,#a1a1aa_50%,#a1a1aa_50%)]",
					mode === "light" && "bg-zinc-400",
					mode === "dark" && "bg-zinc-400",
				)}
			/>
			<span
				className={cn(
					"absolute inset-x-3 bottom-0 h-9 rounded-t-md border border-b-0",
					mode === "system" &&
						"border-white/50 bg-[linear-gradient(90deg,#fafafa_50%,#27272a_50%)]",
					mode === "light" && "border-zinc-200 bg-white",
					mode === "dark" && "border-zinc-600 bg-zinc-900",
				)}
			>
				<span
					className={cn(
						"absolute top-2 left-2 h-1.5 w-8 rounded-full",
						mode === "system" && "bg-zinc-300",
						mode === "light" && "bg-zinc-300",
						mode === "dark" && "bg-zinc-600",
					)}
				/>
				<span
					className={cn(
						"absolute top-5 right-2 left-2 h-px",
						mode === "system" &&
							"bg-[linear-gradient(90deg,#e4e4e7_50%,#52525b_50%)]",
						mode === "light" && "bg-zinc-200",
						mode === "dark" && "bg-zinc-700",
					)}
				/>
			</span>
		</span>
	);
}

function PalettePicker<T extends AppThemeId>({
	label,
	themes,
	value,
	onValueChange,
}: {
	label: string;
	themes: ReadonlyArray<{ id: T; label: string }>;
	value: T;
	onValueChange: (value: T) => void;
}) {
	const currentTheme = themes.find((theme) => theme.id === value) ?? themes[0];
	if (!currentTheme) return null;

	return (
		<div className="flex flex-col gap-2">
			<p className="font-medium text-sm">{label}</p>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							type="button"
							variant="outline"
							className="w-full justify-start"
						/>
					}
				>
					<ThemeIcon theme={currentTheme.id} />
					<span className="truncate">{currentTheme.label}</span>
					<ChevronDownIcon className="ml-auto opacity-50" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-48">
					{themes.map((theme) => (
						<DropdownMenuItem
							key={theme.id}
							onClick={() => onValueChange(theme.id)}
						>
							<ThemeIcon theme={theme.id} />
							{theme.label}
							{value === theme.id ? <CheckIcon className="ml-auto" /> : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export function ThemeSettings() {
	const { mode, lightTheme, darkTheme, setMode, setLightTheme, setDarkTheme } =
		useThemePreferences();

	return (
		<div className="flex flex-col gap-5">
			<fieldset className="flex flex-col gap-2">
				<legend className="font-medium text-sm">Mode</legend>
				<div className="grid grid-cols-3 gap-3">
					{MODE_OPTIONS.map((option) => (
						<label key={option.id} className="group min-w-0 cursor-pointer">
							<input
								type="radio"
								name="theme-mode"
								value={option.id}
								checked={mode === option.id}
								onChange={() => setMode(option.id)}
								className="peer sr-only"
							/>
							<span className="block overflow-hidden rounded-lg border border-border transition-[border-color,box-shadow] group-hover:border-foreground/30 peer-checked:border-ring peer-checked:ring-2 peer-checked:ring-ring/30 peer-focus-visible:border-ring peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50">
								<ThemeModePreview mode={option.id} />
							</span>
							<span className="mt-2 flex items-center justify-center gap-1.5 truncate text-center text-muted-foreground text-sm peer-checked:font-medium peer-checked:text-foreground">
								<option.icon className="size-3.5 shrink-0" />
								{option.label}
							</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="grid gap-4 sm:grid-cols-2">
				<PalettePicker
					label="Light theme"
					themes={LIGHT_APP_THEMES}
					value={lightTheme}
					onValueChange={setLightTheme}
				/>
				<PalettePicker
					label="Dark theme"
					themes={DARK_APP_THEMES}
					value={darkTheme}
					onValueChange={setDarkTheme}
				/>
			</div>
		</div>
	);
}
