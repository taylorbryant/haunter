import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
	PublicPageHeader,
	publicPageContainerClassName,
	publicPageViewport,
} from "@/components/public-page";
import { cn } from "@/lib/utils";
import "./help.css";

export const viewport = publicPageViewport;
export const metadata: Metadata = {
	title: { default: "Handbook · Haunter", template: "%s · Haunter Handbook" },
	description:
		"How to use pages, tasks, canvases, and AI connections in Haunter.",
};
// Handbook pages never read session or workspace data.
export const dynamic = "force-static";

export default function GuidesLayout({ children }: { children: ReactNode }) {
	return (
		<div className="isolate min-h-dvh bg-background text-foreground antialiased">
			<PublicPageHeader section="guides" />
			<main
				id="guides-content"
				tabIndex={-1}
				className={cn(
					publicPageContainerClassName,
					"scroll-mt-36 py-10 outline-none sm:scroll-mt-24 sm:py-14",
				)}
			>
				{children}
			</main>
		</div>
	);
}
