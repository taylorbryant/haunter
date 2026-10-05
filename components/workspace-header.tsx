"use client";

import type { ComponentProps } from "react";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({
	children,
	className,
	historyEnabled = true,
	...props
}: ComponentProps<"header"> & { historyEnabled?: boolean }) {
	return (
		<header
			{...props}
			className={cn(
				"sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 bg-background/90 px-3 backdrop-blur-sm",
				className,
			)}
		>
			<SidebarTrigger />
			<Separator
				orientation="vertical"
				className="mr-2 data-vertical:h-4 data-vertical:self-auto"
			/>
			<HeaderBreadcrumbs />
			<HeaderSaveIndicator historyEnabled={historyEnabled} />
			{children}
		</header>
	);
}
