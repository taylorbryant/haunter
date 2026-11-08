import { ArrowRightIcon } from "lucide-react";
import type { Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { PublicPageMenu } from "@/components/public-page-menu";
import { getResolvedThemeColor } from "@/lib/themes";
import { cn } from "@/lib/utils";

export const publicPageViewport: Viewport = {
	themeColor: getResolvedThemeColor("dracula"),
	colorScheme: "dark",
};

export const publicPageContainerClassName =
	"mx-auto w-full max-w-7xl px-5 sm:px-8";
export const publicPageLinkClassName =
	"inline-flex min-h-12 items-center justify-center gap-2 rounded-lg font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring";
export const publicPageEyebrowClassName =
	"font-mono text-base text-primary sm:text-sm";

type PublicSection = "home" | "guides" | "changelog";

function PublicBrand() {
	return (
		<Link
			href="/"
			aria-label="Haunter homepage"
			className="flex min-h-12 shrink-0 items-center gap-2.5 rounded-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<GhostLogo className="size-6 shrink-0" /> Haunter
		</Link>
	);
}

export function PublicPageHeader({ section }: { section: PublicSection }) {
	const links = [
		{ href: "/", label: "Overview", active: section === "home" },
		{ href: "/guides", label: "Handbook", active: section === "guides" },
		{ href: "/changelog", label: "Changelog", active: section === "changelog" },
	];
	return (
		<header className="sticky top-0 z-20 border-foreground/10 border-b bg-background">
			<div
				className={cn(
					publicPageContainerClassName,
					"flex min-h-20 items-center justify-between gap-6",
				)}
			>
				<div className="flex flex-1 items-center text-lg">
					<PublicBrand />
				</div>
				<nav
					aria-label="Site"
					className="flex items-center gap-8 text-sm max-lg:hidden"
				>
					{links.map(({ href, label, active }) => (
						<Link
							key={href}
							href={href}
							aria-current={active ? "page" : undefined}
							className={cn(
								publicPageLinkClassName,
								"relative text-muted-foreground aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-primary",
							)}
						>
							{label}
						</Link>
					))}
				</nav>
				<div className="flex shrink-0 items-center justify-end gap-2 text-base sm:gap-5 sm:text-sm lg:flex-1">
					<Link
						href="/app"
						prefetch={false}
						className={cn(publicPageLinkClassName, "whitespace-nowrap")}
					>
						<span className="sm:hidden">Open app</span>
						<span className="max-sm:hidden">Open Haunter</span>
						<ArrowRightIcon
							aria-hidden
							className="size-4 shrink-0 max-sm:hidden"
						/>
					</Link>
					<PublicPageMenu links={links} />
				</div>
			</div>
		</header>
	);
}

export function PublicPageFooter() {
	return (
		<footer className="border-foreground/10 border-t py-8">
			<div
				className={cn(
					publicPageContainerClassName,
					"flex flex-wrap items-center justify-between gap-x-10 gap-y-6 text-base sm:text-sm",
				)}
			>
				<PublicBrand />
				<nav
					aria-label="Footer"
					className="flex flex-wrap items-center gap-6 text-muted-foreground"
				>
					{[
						{ href: "/guides", label: "Handbook" },
						{ href: "/changelog", label: "Changelog" },
						{ href: "/app", label: "Open Haunter" },
					].map(({ href, label }) => (
						<Link
							key={href}
							href={href}
							prefetch={false}
							className={cn(publicPageLinkClassName, "font-normal")}
						>
							{label}
						</Link>
					))}
				</nav>
			</div>
		</footer>
	);
}

export function PublicPageShell({
	section,
	contentId,
	children,
}: {
	section: PublicSection;
	contentId: string;
	children: ReactNode;
}) {
	return (
		<div className="isolate flex min-h-dvh flex-col bg-background text-foreground antialiased scheme-only-dark">
			<a
				href={`#${contentId}`}
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-background focus:p-4 focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<PublicPageHeader section={section} />
			{children}
			<PublicPageFooter />
		</div>
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
		<div className={cn("flex flex-col gap-5", className)}>
			<p className={publicPageEyebrowClassName}>{eyebrow}</p>
			<h1 className="max-w-[24ch] text-balance font-medium text-4xl tracking-tight sm:text-5xl">
				{title}
			</h1>
			<p className="max-w-[56ch] text-pretty text-base/7 text-muted-foreground">
				{children}
			</p>
		</div>
	);
}
