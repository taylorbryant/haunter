import type { Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import { getResolvedThemeColor } from "@/lib/themes";
import { cn } from "@/lib/utils";

export const publicPageViewport: Viewport = {
	themeColor: getResolvedThemeColor("dracula"),
	colorScheme: "dark",
};

export const publicPageContainerClassName =
	"mx-auto w-full max-w-7xl px-5 sm:px-8";

export function PublicPageHeader({
	section,
	className,
}: {
	section: "guides" | "changelog";
	className?: string;
}) {
	const destination =
		section === "guides"
			? { href: "/changelog", label: "Changelog" }
			: { href: "/guides", label: "Guides" };
	return (
		<header
			className={cn(
				"sticky top-0 z-20 border-border/70 border-b bg-background",
				className,
			)}
		>
			<div
				className={cn(
					publicPageContainerClassName,
					"flex min-h-16 items-center justify-between gap-2 sm:gap-4",
				)}
			>
				<Link
					href="/"
					aria-label="Haunter homepage"
					className="flex shrink-0 items-center gap-2 rounded-sm font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<GhostLogo aria-hidden className="size-5 shrink-0" />
					Haunter
				</Link>
				<nav
					aria-label="Site"
					className="flex items-center gap-2 text-sm sm:gap-6"
				>
					<Link
						href={destination.href}
						className="flex min-h-11 items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						{destination.label}
					</Link>
					<Button
						size="sm"
						variant="outline"
						nativeButton={false}
						render={<Link href="/" />}
					>
						Open Haunter
					</Button>
				</nav>
			</div>
		</header>
	);
}

export function PublicPageIntro({
	eyebrow,
	title,
	children,
	className,
}: {
	eyebrow: string;
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-4", className)}>
			<p className="font-medium text-sm text-muted-foreground">{eyebrow}</p>
			<h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
				{title}
			</h1>
			<p className="max-w-[60ch] text-pretty text-base/7 text-muted-foreground">
				{children}
			</p>
		</div>
	);
}
