"use client";

import { PaintbrushIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_THEMES } from "@/lib/themes";
import type { useEmbeddedAppearance } from "../client/embedded-appearance";
import { EmbeddedAppearanceSchema } from "../schemas";

/** Fallback for hosts that don't render the MCP settings extension. */
export function EmbeddedAppearanceMenu({
	appearance,
}: {
	appearance: ReturnType<typeof useEmbeddedAppearance>;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label="Appearance"
						title="Appearance"
					/>
				}
			>
				<PaintbrushIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Theme</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={appearance.theme}
						onValueChange={(value) => {
							const parsed = EmbeddedAppearanceSchema.safeParse({
								theme: value,
							});
							if (parsed.success) appearance.change(parsed.data.theme);
						}}
					>
						<DropdownMenuRadioItem
							closeOnClick
							value="host"
							disabled={appearance.loading || appearance.saving}
						>
							Follow host
						</DropdownMenuRadioItem>
						<DropdownMenuSeparator />
						{APP_THEMES.map((theme) => (
							<DropdownMenuRadioItem
								closeOnClick
								key={theme.id}
								value={theme.id}
								disabled={appearance.loading || appearance.saving}
							>
								{theme.label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					{appearance.error && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={appearance.retry}>
								Retry theme sync
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
