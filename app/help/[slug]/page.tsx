import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpMarkdown } from "@/features/help/components/help-markdown";
import { loadHelpGuide } from "@/features/help/content";
import { findHelpGuide, HELP_GUIDES } from "@/features/help/guides";

export const dynamicParams = false;

export function generateStaticParams() {
	return HELP_GUIDES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const guide = findHelpGuide((await params).slug);
	if (!guide) notFound();
	return { title: guide.title, description: guide.description };
}

export default async function HelpGuidePage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const guide = await loadHelpGuide((await params).slug);
	if (!guide) notFound();
	const index = HELP_GUIDES.findIndex((item) => item.slug === guide.slug);
	const next = HELP_GUIDES[index + 1];
	const contents = (
		// biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari when Tailwind removes list markers.
		<ul role="list" className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
			{guide.headings.map((heading) => (
				<li key={heading.id} className="text-base sm:text-sm">
					<a
						href={`#${heading.id}`}
						className="flex min-h-11 items-center rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
					>
						{heading.title}
					</a>
				</li>
			))}
		</ul>
	);
	return (
		<article className="flex flex-col gap-10">
			<header className="flex flex-col gap-4">
				<p className="text-base text-muted-foreground sm:text-sm">
					<Link
						href="/help"
						className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					>
						All guides
					</Link>
				</p>
				<h1 className="max-w-[25ch] text-pretty font-semibold text-3xl tracking-tight sm:text-4xl">
					{guide.title}
				</h1>
				<p className="max-w-[65ch] text-pretty text-base/7 text-muted-foreground">
					{guide.description}
				</p>
			</header>
			<nav
				aria-label="On this page"
				className="max-w-[70ch] border-border/70 border-y py-5"
			>
				<details className="sm:hidden">
					<summary className="cursor-pointer rounded-sm py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
						On this page
					</summary>
					<div className="pt-3">{contents}</div>
				</details>
				<div className="max-sm:hidden">
					<p className="pb-3 font-medium">On this page</p>
					{contents}
				</div>
			</nav>
			<HelpMarkdown>{guide.content}</HelpMarkdown>
			<nav
				aria-label="Continue reading"
				className="max-w-[70ch] border-border/70 border-t pt-6 text-base"
			>
				<Link
					href={next ? `/help/${next.slug}` : "/help"}
					className="flex flex-col gap-2 rounded-sm py-2 underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					<p className="text-muted-foreground">
						{next ? "Up next" : "Keep exploring"}
					</p>
					<p className="font-medium">{next?.title ?? "Browse all guides"} →</p>
				</Link>
			</nav>
		</article>
	);
}
