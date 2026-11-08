import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { PublicPageIntro } from "@/components/public-page";
import { HELP_GUIDES } from "@/features/help/guides";

export default function GuidesPage() {
	return (
		<div className="mx-auto max-w-3xl">
			<PublicPageIntro title="Guides">
				How to write, plan, and draw in Haunter.
			</PublicPageIntro>
			<nav aria-label="Guide topics" className="mt-10">
				<ul
					// biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari when Tailwind removes markers.
					role="list"
					className="divide-y divide-foreground/10 border-foreground/10 border-y"
				>
					{HELP_GUIDES.map((guide) => (
						<li key={guide.slug}>
							<Link
								href={`/guides/${guide.slug}`}
								className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 rounded-md py-6 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[11rem_1fr_auto]"
							>
								<span className="font-medium text-lg group-hover:text-primary sm:text-base">
									{guide.title}
								</span>
								<span className="col-start-1 row-start-2 text-pretty text-base/7 text-muted-foreground sm:col-start-2 sm:row-start-1">
									{guide.description}
								</span>
								<ArrowRightIcon
									aria-hidden
									className="col-start-2 row-start-1 size-4 text-muted-foreground group-hover:text-primary sm:col-start-3"
								/>
							</Link>
						</li>
					))}
				</ul>
			</nav>
		</div>
	);
}
