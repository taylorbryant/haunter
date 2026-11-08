import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import {
	PublicPageShell,
	publicPageContainerClassName,
} from "@/components/public-page";
import { cn } from "@/lib/utils";
import { ProductPreview } from "./product-preview";

export function Homepage() {
	return (
		<PublicPageShell section="home" contentId="main-content">
			<main
				id="main-content"
				tabIndex={-1}
				className="flex-1 scroll-mt-28 outline-none"
			>
				<section
					aria-labelledby="hero-heading"
					className="py-12 sm:pt-20 sm:pb-16"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"flex flex-col items-center text-center",
						)}
					>
						<h1
							id="hero-heading"
							className="max-w-3xl text-balance font-medium text-5xl tracking-tight sm:text-6xl lg:text-7xl"
						>
							A home for your ideas.
						</h1>
						<p className="mt-5 max-w-[40ch] text-pretty text-lg/7 text-muted-foreground">
							Notes, tasks, and canvases. Together with your team and your AI.
						</p>
						<Link
							href="/sign-up"
							prefetch={false}
							className="mt-8 inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-primary py-3 pr-3 pl-4 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
						>
							Request access{" "}
							<ArrowRightIcon aria-hidden className="size-4 shrink-0" />
						</Link>
						<p className="mt-3 text-base text-muted-foreground sm:text-sm">
							Invite-only. Join the waitlist.
						</p>
					</div>
				</section>
				<section aria-label="Explore the workspace" className="pb-12 sm:pb-20">
					<div className={publicPageContainerClassName}>
						<ProductPreview />
					</div>
				</section>
			</main>
		</PublicPageShell>
	);
}
