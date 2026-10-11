import Link from "next/link";
import { HELP_GUIDES } from "@/features/help/guides";

export default function HelpPage() {
	return (
		<div className="flex flex-col gap-10 sm:gap-14">
			<div className="flex flex-col gap-4">
				<p className="font-medium text-muted-foreground">Haunter Help</p>
				<h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
					Your guide to Haunter
				</h1>
				<p className="max-w-[60ch] text-pretty text-base/7 text-muted-foreground">
					Learn your way around pages, tasks, and canvases, or bring an AI
					assistant into your workspace.
				</p>
			</div>
			<div className="grid gap-x-10 sm:grid-cols-2">
				{HELP_GUIDES.map((guide, index) => (
					<Link
						key={guide.slug}
						href={`/help/${guide.slug}`}
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
