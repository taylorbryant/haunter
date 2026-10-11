import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
	PublicPageHeader,
	publicPageContainerClassName,
	publicPageViewport,
} from "@/components/public-page";
import { HelpNavigation } from "@/features/help/components/help-navigation";
import "./help.css";

export const viewport = publicPageViewport;

export const metadata: Metadata = {
	title: { default: "Guides · Haunter", template: "%s · Haunter Guides" },
	description:
		"Learn to write, organize tasks, draw, and work with an AI assistant in Haunter.",
};

// Guide pages never read session or workspace data, including through the layout.
export const dynamic = "force-static";

export default function GuidesLayout({ children }: { children: ReactNode }) {
	return (
		<div className="isolate min-h-dvh bg-background text-foreground antialiased">
			<a
				href="#guides-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<PublicPageHeader section="guides" />
			<div className={publicPageContainerClassName}>
				<HelpNavigation mobile />
				<div className="grid gap-12 py-10 sm:py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
					<aside className="self-start lg:sticky lg:top-24 max-lg:hidden">
						<p className="px-3 pb-4 font-medium text-sm">Haunter Guides</p>
						<HelpNavigation />
					</aside>
					<main
						id="guides-content"
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
