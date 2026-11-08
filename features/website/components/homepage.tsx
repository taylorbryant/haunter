import {
	ArrowDownIcon,
	ArrowRightIcon,
	CheckIcon,
	FileTextIcon,
	ListTodoIcon,
	BookOpenIcon,
	ShapesIcon,
} from "lucide-react";
import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import {
	PublicPageShell,
	publicPageContainerClassName,
	publicPageLinkClassName as linkClassName,
	publicPageEyebrowClassName,
} from "@/components/public-page";
import { cn } from "@/lib/utils";
import { ProductPreview } from "./product-preview";

const features = [
	{
		label: "Pages",
		icon: FileTextIcon,
		title: "Write it down",
		description:
			"Start with a sentence. Add a checklist, a code block, or a page within a page. Keep related ideas close.",
		href: "/guides/pages",
		link: "Learn about pages",
	},
	{
		label: "Tasks",
		icon: ListTodoIcon,
		title: "Make it happen",
		description:
			"Turn a note into a task, give it a date, and assign it to someone. See everything that needs doing in one place.",
		href: "/guides/tasks",
		link: "Learn about tasks",
	},
	{
		label: "Canvases",
		icon: ShapesIcon,
		title: "Draw it out",
		description:
			"Sketch a flow, map an idea, or draw something out together. Your canvas can live right inside your notes.",
		href: "/guides/canvases",
		link: "Learn about canvases",
	},
] as const;

function AgentExample() {
	return (
		<figure className="overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/2">
			<figcaption className="border-foreground/10 border-b px-6 py-4 text-base text-muted-foreground sm:text-sm">
				One idea, a little help, a real next step
			</figcaption>
			<div className="flex flex-col gap-7 p-6 sm:p-8">
				<div className="flex flex-col gap-3">
					<p className="font-medium text-base sm:text-sm">
						You, in your AI app
					</p>
					<blockquote className="text-pretty text-xl text-foreground/90">
						“Turn my workshop notes into a checklist, and sketch a flow for the
						afternoon.”
					</blockquote>
				</div>
				<div
					className="flex items-center gap-3 text-muted-foreground"
					aria-hidden
				>
					<ArrowDownIcon className="size-4 shrink-0" />
					<div className="h-px flex-1 bg-foreground/10" />
				</div>
				<div className="flex flex-col gap-5">
					<p className="flex items-center gap-2 font-medium text-base sm:text-sm">
						<GhostLogo className="size-5 shrink-0" /> Back in Haunter
					</p>
					<ul
						// biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari when Tailwind removes list markers.
						role="list"
						className="flex flex-col gap-3 text-base text-muted-foreground sm:text-sm"
					>
						{[
							"A checklist beside your original notes",
							"A workshop flow you can keep editing",
							"Everything in the workspace you chose",
						].map((item) => (
							<li key={item} className="flex items-start gap-3">
								<CheckIcon
									aria-hidden
									className="size-4 h-lh shrink-0 stroke-primary"
								/>
								{item}
							</li>
						))}
					</ul>
				</div>
				<p className="border-foreground/10 border-t pt-5 text-pretty text-base text-muted-foreground sm:text-sm">
					An example of what you can ask a connected agent to do.
				</p>
			</div>
		</figure>
	);
}

export function Homepage() {
	return (
		<PublicPageShell section="home" contentId="main-content">
			<main id="main-content" tabIndex={-1} className="flex-1 outline-none">
				<section
					aria-labelledby="hero-heading"
					className="pt-10 pb-10 sm:pt-20 sm:pb-14"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"grid items-end gap-8 lg:grid-cols-[3fr_2fr] lg:gap-16",
						)}
					>
						<div className="flex flex-col gap-6">
							<p className={publicPageEyebrowClassName}>
								Pages. Tasks. Canvases.
							</p>
							<h1
								id="hero-heading"
								className="max-w-[18ch] text-balance font-medium text-5xl tracking-tight sm:text-6xl lg:text-7xl"
							>
								Keep your ideas in good company
							</h1>
						</div>
						<div className="flex flex-col items-start gap-6">
							<p className="max-w-[44ch] text-pretty text-lg/8 text-muted-foreground">
								A shared space for notes, next steps, and sketches. Work on your
								own, with your team, or alongside your AI agent.
							</p>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
								<Link
									href="/sign-up"
									prefetch={false}
									className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-primary py-3 pr-3 pl-4 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
								>
									Request access{" "}
									<ArrowRightIcon aria-hidden className="size-4 shrink-0" />
								</Link>
								<Link href="/guides" className={linkClassName}>
									Read the Handbook
								</Link>
							</div>
							<p className="text-base text-muted-foreground sm:text-sm">
								Currently invite-only. Request access to join the waitlist.
							</p>
						</div>
					</div>
				</section>
				<section
					id="workspace"
					aria-label="Explore the workspace"
					className="scroll-mt-28 pb-16 sm:pb-20"
				>
					<div className={publicPageContainerClassName}>
						<ProductPreview />
					</div>
				</section>
				<section
					aria-labelledby="features-heading"
					className="border-foreground/10 border-t py-16 sm:py-20"
				>
					<div className={publicPageContainerClassName}>
						<div className="flex flex-col gap-5">
							<p className={publicPageEyebrowClassName}>
								One workspace, a few ways to think.
							</p>
							<h2
								id="features-heading"
								className="max-w-[30ch] text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								Your notes and next steps belong together
							</h2>
						</div>
						<dl className="mt-12 grid gap-10 lg:grid-cols-3">
							{features.map(
								({ label, icon: Icon, title, description, href, link }) => (
									<div
										key={label}
										className="flex flex-col gap-5 border-foreground/10 border-t pt-6"
									>
										<dt className="flex flex-col gap-6 font-medium text-xl">
											<div className="flex items-center gap-3 text-base text-muted-foreground sm:text-sm">
												<Icon aria-hidden className="size-6 shrink-0" />
												<span>{label}</span>
											</div>
											{title}
										</dt>
										<dd className="flex flex-1 flex-col items-start gap-5 text-base/7 text-muted-foreground">
											<p className="max-w-[56ch] flex-1 text-pretty">
												{description}
											</p>
											<Link
												href={href}
												className={cn(linkClassName, "text-foreground")}
											>
												{link}{" "}
												<ArrowRightIcon
													aria-hidden
													className="size-4 shrink-0"
												/>
											</Link>
										</dd>
									</div>
								),
							)}
						</dl>
					</div>
				</section>
				<section
					id="ai"
					aria-labelledby="ai-heading"
					className="scroll-mt-28 border-foreground/10 border-t py-16 sm:py-20"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"grid items-center gap-10 lg:grid-cols-2",
						)}
					>
						<div className="flex flex-col items-start gap-6">
							<p className={publicPageEyebrowClassName}>Bring your AI along.</p>
							<h2
								id="ai-heading"
								className="max-w-[20ch] text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								Your AI, on the same page
							</h2>
							<p className="max-w-[48ch] text-pretty text-lg/8 text-muted-foreground">
								Connect your AI app to Haunter. Ask an agent to find a note,
								draft a page, organize tasks, or help with a drawing. Then pick
								up right where it left off.
							</p>
							<p className="max-w-[56ch] text-pretty text-base/7 text-muted-foreground">
								You choose the workspaces and the level of access. Review or
								disconnect your agents whenever you like.
							</p>
							<div className="text-base">
								<Link href="/guides/ai" className={linkClassName}>
									See how AI connections work{" "}
									<ArrowRightIcon aria-hidden className="size-4 shrink-0" />
								</Link>
							</div>
						</div>
						<AgentExample />
					</div>
				</section>
				<section
					aria-labelledby="handbook-heading"
					className="border-foreground/10 border-t py-16 sm:py-20"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"grid items-start gap-8 lg:grid-cols-2 lg:gap-10",
						)}
					>
						<div className="flex flex-col gap-5">
							<p
								className={cn(
									publicPageEyebrowClassName,
									"flex items-center gap-3",
								)}
							>
								<BookOpenIcon aria-hidden className="size-5" /> The Haunter
								Handbook
							</p>
							<h2
								id="handbook-heading"
								className="text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								Make yourself at home
							</h2>
						</div>
						<div className="flex flex-col items-start gap-5">
							<p className="max-w-[48ch] text-pretty text-lg/8 text-muted-foreground">
								Start with your first page. Find a way to organize your week.
								Learn how to share a workspace or connect an agent. The Handbook
								walks you through it.
							</p>
							<div className="flex flex-wrap gap-x-8 gap-y-2">
								<Link href="/guides/getting-started" className={linkClassName}>
									Start with the basics{" "}
									<ArrowRightIcon aria-hidden className="size-4" />
								</Link>
								<Link
									href="/guides/sharing-and-exporting"
									className={cn(linkClassName, "text-muted-foreground")}
								>
									More about sharing
								</Link>
							</div>
						</div>
					</div>
				</section>
			</main>
		</PublicPageShell>
	);
}
