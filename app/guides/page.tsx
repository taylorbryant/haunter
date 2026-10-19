import Link from "next/link";
import { PublicPageIntro } from "@/components/public-page";
import { HELP_GUIDES } from "@/features/help/guides";

export default function GuidesPage() {
	return (
		<div className="flex flex-col gap-10 sm:gap-14">
			<PublicPageIntro eyebrow="Haunter Guides" title="Your guide to Haunter">
				Learn your way around pages, tasks, and canvases, or bring an AI agent
				into your workspace.
			</PublicPageIntro>
			<div className="grid gap-x-10 sm:grid-cols-2">
				{HELP_GUIDES.map((guide, index) => (
					<Link
						key={guide.slug}
						href={`/guides/${guide.slug}`}
						className="group flex flex-col gap-3 border-border/70 border-t py-7 outline-none hover:text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
					>
						<p className="text-sm text-muted-foreground tabular-nums">
							0{index + 1}
						</p>
						<h2 className="text-balance font-semibold text-xl group-hover:underline group-hover:underline-offset-4">
							{guide.title}
						</h2>
						<p className="max-w-[45ch] text-pretty text-base/7 text-muted-foreground">
							{guide.description}
						</p>
					</Link>
				))}
			</div>
		</div>
	);
}
