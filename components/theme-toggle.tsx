"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { ThemeIcon } from "@/components/theme-icon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_OPTIONS } from "@/lib/themes";

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const currentTheme =
		THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label="Change theme"
					/>
				}
			>
				<ThemeIcon theme={currentTheme.id} />
				{currentTheme.label}
				<ChevronDownIcon className="opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{THEME_OPTIONS.map((option) => (
					<DropdownMenuItem key={option.id} onClick={() => setTheme(option.id)}>
						<ThemeIcon theme={option.id} />
						{option.label}
						{theme === option.id ? <CheckIcon className="ml-auto" /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
