import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
	PublicPageShell,
	publicPageContainerClassName,
	publicPageViewport,
} from "@/components/public-page";
import { HelpNavigation } from "@/features/help/components/help-navigation";
import "./help.css";

export const viewport = publicPageViewport;

export const metadata: Metadata = {
	title: { default: "Handbook · Haunter", template: "%s · Haunter Handbook" },
	description:
		"Learn to write, organize tasks, draw, and work with an AI agent in Haunter.",
};

// Guide pages never read session or workspace data, including through the layout.
export const dynamic = "force-static";

export default function GuidesLayout({ children }: { children: ReactNode }) {
	return (
		<PublicPageShell section="guides" contentId="guides-content">
			<div className={`${publicPageContainerClassName} flex-1`}>
				<HelpNavigation mobile />
				<div className="grid gap-12 py-10 sm:py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
					<aside className="self-start lg:sticky lg:top-28 max-lg:hidden">
						<p className="px-3 pb-4 font-medium text-sm">Contents</p>
						<HelpNavigation />
					</aside>
					<main
						id="guides-content"
						tabIndex={-1}
						className="min-w-0 scroll-mt-28 outline-none"
					>
						{children}
					</main>
				</div>
			</div>
		</PublicPageShell>
	);
}
