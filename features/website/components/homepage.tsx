import {
	ArrowDownIcon,
	ArrowRightIcon,
	CheckIcon,
	FileTextIcon,
	ListTodoIcon,
	MenuIcon,
	ShapesIcon,
} from "lucide-react";
import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import { publicPageContainerClassName } from "@/components/public-page";
import { cn } from "@/lib/utils";
import { ProductPreview } from "./product-preview";

const linkClassName =
	"inline-flex min-h-12 items-center justify-center gap-2 rounded-lg font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring";

const navigation = [
	{ href: "#workspace", label: "The workspace" },
	{ href: "#ai", label: "Made for AI, too" },
	{ href: "/guides", label: "Guides" },
] as const;

function Brand() {
	return (
		<Link
			href="/"
			aria-label="Homepage"
			className="flex min-h-12 shrink-0 items-center gap-2.5 rounded-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<GhostLogo className="size-6 shrink-0" />
			Haunter
		</Link>
	);
}

function WebsiteHeader() {
	return (
		<header className="relative z-10 border-foreground/10 border-b">
			<div
				className={cn(
					publicPageContainerClassName,
					"flex min-h-20 items-center justify-between gap-6",
				)}
			>
				<div className="flex flex-1 items-center text-lg">
					<Brand />
				</div>
				<nav
					aria-label="Main"
					className="flex items-center gap-8 text-sm text-muted-foreground max-lg:hidden"
				>
					{navigation.map(({ href, label }) => (
						<Link key={href} href={href} className={linkClassName}>
							{label}
						</Link>
					))}
				</nav>
				<div className="flex shrink-0 items-center justify-end gap-2 text-base sm:gap-5 sm:text-sm lg:flex-1">
					<Link
						href="/app"
						prefetch={false}
						className={cn(linkClassName, "whitespace-nowrap")}
					>
						<span className="sm:hidden">Open app</span>
						<span className="max-sm:hidden">Open Haunter</span>
						<ArrowRightIcon
							aria-hidden
							className="size-4 shrink-0 max-sm:hidden"
						/>
					</Link>
					<details className="group lg:hidden">
						<summary className="flex size-12 cursor-pointer list-none items-center justify-center rounded-lg outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
							<MenuIcon aria-hidden className="size-6 shrink-0" />
							<span className="sr-only">Navigation menu</span>
						</summary>
						<nav
							aria-label="Mobile"
							className="absolute inset-x-0 top-full flex flex-col gap-1 border-foreground/10 border-b bg-background px-5 py-4"
						>
							{navigation.map(({ href, label }) => (
								<Link
									key={href}
									href={href}
									className={cn(linkClassName, "justify-start px-3")}
								>
									{label}
								</Link>
							))}
						</nav>
					</details>
				</div>
			</div>
		</header>
	);
}

const features = [
	{
		number: "01",
		icon: FileTextIcon,
		title: "Give a thought a home",
		description:
			"Start with a sentence. Add a checklist, a code block, or a page within a page. Keep related ideas close.",
		href: "/guides/pages",
		link: "Explore pages",
	},
	{
		number: "02",
		icon: ListTodoIcon,
		title: "Find your next step",
		description:
			"Turn a note into a task, give it a date, and assign it to someone. See everything that needs doing in one place.",
		href: "/guides/tasks",
		link: "Explore tasks",
	},
	{
		number: "03",
		icon: ShapesIcon,
		title: "Think outside the text",
		description:
			"Sketch a flow, map an idea, or draw something out together. Your canvas can live right inside your notes.",
		href: "/guides/canvases",
		link: "Explore canvases",
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
		<div className="isolate min-h-dvh bg-background text-foreground antialiased scheme-only-dark">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-background focus:p-4 focus:ring-2 focus:ring-ring"
			>
				Skip to content
			</a>
			<WebsiteHeader />
			<main id="main-content" tabIndex={-1} className="outline-none">
				<section
					aria-labelledby="hero-heading"
					className="pt-16 pb-12 sm:pt-24 sm:pb-16"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"flex flex-col items-center gap-7 text-center",
						)}
					>
						<p className="font-mono text-base text-primary sm:text-sm">
							A little space for your next big idea.
						</p>
						<h1
							id="hero-heading"
							className="max-w-[18ch] text-balance font-medium text-5xl tracking-tight sm:text-6xl lg:text-7xl"
						>
							Keep your ideas in good company
						</h1>
						<p className="max-w-[48ch] text-pretty text-lg/8 text-muted-foreground">
							Write a page. Sketch a plan. Find your next step.
							<br className="max-sm:hidden" /> Bring your team and your AI
							along.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-base">
							<Link
								href="/sign-up"
								prefetch={false}
								className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-primary py-3 pr-3 pl-4 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
							>
								Request access{" "}
								<ArrowRightIcon aria-hidden className="size-6 shrink-0" />
							</Link>
							<a href="#workspace" className={linkClassName}>
								Take a look{" "}
								<ArrowDownIcon aria-hidden className="size-4 shrink-0" />
							</a>
						</div>
						<p className="text-base text-muted-foreground sm:text-sm">
							Thoughtfully growing. Access by invitation.
						</p>
					</div>
				</section>
				<section
					id="workspace"
					aria-label="Explore the workspace"
					className="scroll-mt-6 pb-20 sm:pb-28"
				>
					<div className={publicPageContainerClassName}>
						<ProductPreview />
					</div>
				</section>
				<section
					aria-labelledby="features-heading"
					className="border-foreground/10 border-t py-20 sm:py-28"
				>
					<div className={publicPageContainerClassName}>
						<div className="flex flex-col gap-5">
							<p className="font-mono text-base text-primary sm:text-sm">
								Room to think. Room to do.
							</p>
							<h2
								id="features-heading"
								className="max-w-[30ch] text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								From a passing thought
								<br />
								to something you can build on
							</h2>
						</div>
						<dl className="mt-12 grid gap-10 lg:grid-cols-3">
							{features.map(
								({ number, icon: Icon, title, description, href, link }) => (
									<div
										key={number}
										className="flex flex-col gap-5 border-foreground/10 border-t pt-6"
									>
										<dt className="flex flex-col gap-6 font-medium text-xl">
											<div className="flex items-center justify-between text-base text-muted-foreground sm:text-sm">
												<Icon aria-hidden className="size-6 shrink-0" />
												<span className="font-mono tabular-nums">{number}</span>
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
					className="scroll-mt-6 border-foreground/10 border-t py-20 sm:py-28"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"grid items-center gap-10 lg:grid-cols-2",
						)}
					>
						<div className="flex flex-col items-start gap-6">
							<p className="font-mono text-base text-primary sm:text-sm">
								Good company includes your AI.
							</p>
							<h2
								id="ai-heading"
								className="max-w-[20ch] text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								Bring the conversation
								<br />
								into your workspace
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
					aria-labelledby="together-heading"
					className="border-foreground/10 border-t py-20 sm:py-28"
				>
					<div
						className={cn(
							publicPageContainerClassName,
							"grid gap-10 lg:grid-cols-2",
						)}
					>
						<div className="flex flex-col gap-5">
							<p className="font-mono text-base text-primary sm:text-sm">
								Your space. Shared when you want.
							</p>
							<h2
								id="together-heading"
								className="max-w-[25ch] text-balance font-medium text-3xl tracking-tight sm:text-4xl"
							>
								Make something
								<br />
								of what’s on your mind
							</h2>
						</div>
						<div className="flex flex-col items-start gap-6">
							<p className="max-w-[48ch] text-pretty text-lg/8 text-muted-foreground">
								Keep a corner for your own ideas. Invite people into a shared
								workspace. Write and draw together, or share a single page with
								a public link.
							</p>
							<div className="flex flex-wrap gap-x-8 gap-y-2 text-base">
								<Link
									href="/sign-up"
									prefetch={false}
									className={linkClassName}
								>
									Find your space{" "}
									<ArrowRightIcon aria-hidden className="size-4 shrink-0" />
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
			<footer className="border-foreground/10 border-t py-8">
				<div
					className={cn(
						publicPageContainerClassName,
						"flex flex-wrap items-center justify-between gap-x-10 gap-y-6 text-base sm:text-sm",
					)}
				>
					<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
						<Brand />
						<p className="text-muted-foreground">A home for your ideas.</p>
					</div>
					<nav
						aria-label="Footer"
						className="flex flex-wrap items-center gap-6 text-muted-foreground"
					>
						{[
							{ href: "/guides", label: "Guides" },
							{ href: "/changelog", label: "Changelog" },
							{ href: "/app", label: "Open Haunter" },
						].map(({ href, label }) => (
							<Link
								key={href}
								href={href}
								prefetch={false}
								className={cn(linkClassName, "font-normal")}
							>
								{label}
							</Link>
						))}
					</nav>
				</div>
			</footer>
		</div>
	);
}
