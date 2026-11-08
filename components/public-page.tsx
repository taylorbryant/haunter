import { ArrowUpRightIcon } from "lucide-react";
import type { Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { getResolvedThemeColor } from "@/lib/themes";
import { cn } from "@/lib/utils";

export const publicPageViewport: Viewport = {
	themeColor: getResolvedThemeColor("dracula"),
	colorScheme: "dark",
};

export const publicPageContainerClassName =
	"mx-auto w-full max-w-6xl px-5 sm:px-8";

export function PublicPageHeader({
	section,
}: {
	section: "guides" | "changelog";
}) {
	return (
		<>
			<a
				href={`#${section}-content`}
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-20 border-foreground/10 border-b bg-background">
				<div
					className={cn(
						publicPageContainerClassName,
						"grid grid-cols-[1fr_auto] items-center gap-x-8 pt-2 sm:min-h-16 sm:grid-cols-[1fr_auto_1fr] sm:py-0",
					)}
				>
					<Link
						href="/"
						prefetch={false}
						aria-label="Haunter"
						className="flex min-h-12 w-fit items-center gap-2 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<GhostLogo aria-hidden className="size-5 shrink-0" />
						Haunter
					</Link>
					<nav
						aria-label="Site"
						className="col-span-2 row-start-2 flex gap-6 text-base sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-sm"
					>
						{[
							{ href: "/guides", label: "Handbook", id: "guides" },
							{ href: "/changelog", label: "Changelog", id: "changelog" },
						].map((link) => (
							<Link
								key={link.id}
								href={link.href}
								aria-current={section === link.id ? "page" : undefined}
								className="flex min-h-12 items-center border-transparent border-b-2 text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground sm:min-h-16"
							>
								{link.label}
							</Link>
						))}
					</nav>
					<Link
						href="/"
						prefetch={false}
						className="col-start-2 row-start-1 flex min-h-12 items-center justify-self-end gap-2 rounded-md text-base text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:col-start-3 sm:text-sm"
					>
						Open Haunter{" "}
						<ArrowUpRightIcon aria-hidden className="size-4 shrink-0" />
					</Link>
				</div>
			</header>
		</>
	);
}

export function PublicPageIntro({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h1 className="text-balance font-medium text-3xl tracking-tight sm:text-4xl">
				{title}
			</h1>
			<p className="max-w-[54ch] text-pretty text-base/7 text-muted-foreground">
				{children}
			</p>
		</div>
	);
}
