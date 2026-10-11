import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import { HelpNavigation } from "@/features/help/components/help-navigation";
import "./help.css";

export const metadata: Metadata = {
	title: { default: "Help · Haunter", template: "%s · Haunter Help" },
	description:
		"Learn to write, organize tasks, draw, and work with an AI assistant in Haunter.",
};

// Help never reads session or workspace data, including through its layout.
export const dynamic = "force-static";

export default function HelpLayout({ children }: { children: ReactNode }) {
	return (
		<div className="isolate min-h-dvh bg-background text-foreground antialiased">
			<a
				href="#help-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-20 border-border/70 border-b bg-background">
				<div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
					<Link
						href="/"
						aria-label="Haunter homepage"
						className="flex items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<GhostLogo className="size-5 shrink-0" />
						Haunter
					</Link>
					<nav
						aria-label="Site"
						className="flex items-center gap-4 text-sm sm:gap-6"
					>
						<Link
							href="/changelog"
							className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden"
						>
							Changelog
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
			<div className="mx-auto max-w-7xl px-5 sm:px-8">
				<HelpNavigation mobile />
				<div className="grid gap-12 py-10 sm:py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
					<aside className="self-start lg:sticky lg:top-24 max-lg:hidden">
						<p className="px-3 pb-4 font-medium text-sm">Haunter Help</p>
						<HelpNavigation />
					</aside>
					<main
						id="help-content"
						tabIndex={-1}
						className="min-w-0 outline-none"
					>
						{children}
					</main>
				</div>
			</div>
		</div>
	);
}
