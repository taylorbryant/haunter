import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import {
	PublicPageIntro,
	publicPageEyebrowClassName,
} from "@/components/public-page";
import { HELP_GUIDES } from "@/features/help/guides";

export default function GuidesPage() {
	return (
		<div className="flex flex-col gap-10 sm:gap-12">
			<PublicPageIntro
				eyebrow="Make yourself at home."
				title="The Haunter Handbook"
			>
				A few good starting points for writing, planning, drawing, and working
				together in Haunter.
			</PublicPageIntro>
			<Link
				href="/guides/getting-started"
				className="group grid gap-5 rounded-xl border border-foreground/10 bg-foreground/3 p-6 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[1fr_auto] sm:items-center sm:p-8"
			>
				<div className="flex flex-col gap-3">
					<p className={publicPageEyebrowClassName}>Start here</p>
					<h2 className="text-balance font-medium text-2xl">
						Your first few minutes
					</h2>
					<p className="max-w-[48ch] text-pretty text-base/7 text-muted-foreground">
						Find your way around, create a page, and give your next idea a place
						to grow.
					</p>
				</div>
				<ArrowRightIcon
					aria-hidden
					className="size-6 shrink-0 text-muted-foreground group-hover:text-primary"
				/>
			</Link>
			<section aria-labelledby="chapters-heading">
				<h2 id="chapters-heading" className="mb-6 font-medium text-xl">
					Explore the workspace
				</h2>
				<div className="grid gap-x-10 sm:grid-cols-2">
					{HELP_GUIDES.slice(1).map((guide, index) => (
						<Link
							key={guide.slug}
							href={`/guides/${guide.slug}`}
							className="group flex flex-col gap-3 border-foreground/10 border-t py-7 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
						>
							<p className="font-mono text-base text-muted-foreground tabular-nums sm:text-sm">
								{String(index + 2).padStart(2, "0")}
							</p>
							<h3 className="flex items-center justify-between gap-4 text-balance font-medium text-xl group-hover:text-primary">
								{guide.title}
								<ArrowRightIcon
									aria-hidden
									className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
								/>
							</h3>
							<p className="max-w-[45ch] text-pretty text-base/7 text-muted-foreground">
								{guide.description}
							</p>
						</Link>
					))}
				</div>
			</section>
		</div>
	);
}
