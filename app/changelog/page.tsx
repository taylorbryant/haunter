import type { Metadata } from "next";
import {
	PublicPageHeader,
	PublicPageIntro,
	publicPageContainerClassName,
	publicPageViewport,
} from "@/components/public-page";
import { Badge } from "@/components/ui/badge";
import { ChangelogSeenTracker } from "@/features/changelog/components/changelog-seen-tracker";
import { loadChangelogReleases } from "@/features/changelog/content";
import {
	CHANGELOG_RELEASES,
	type ChangelogRelease,
} from "@/features/changelog/releases";
import { cn } from "@/lib/utils";

export const viewport = publicPageViewport;

export const metadata: Metadata = {
	title: "Changelog · Haunter",
	description:
		"New features, improvements, and fixes in every Haunter release.",
};

export const dynamic = "force-static";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "long",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

function formatReleaseDate(date: string) {
	return dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

function Release({
	release,
	latest,
}: {
	release: ChangelogRelease;
	latest: boolean;
}) {
	return (
		<article className="grid gap-6 border-border/70 border-t py-10 first:border-t-0 first:pt-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 sm:py-14">
			<div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-2">
				<p className="font-medium text-sm tabular-nums">
					{formatReleaseDate(release.date)}
				</p>
				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="font-mono tabular-nums">
						v{release.version}
					</Badge>
					{latest ? <Badge>Latest</Badge> : null}
				</div>
			</div>
			<div className="min-w-0 max-w-[70ch]">
				<h2 className="text-balance font-semibold text-2xl tracking-tight">
					{release.title}
				</h2>
				<div className="mt-8 flex flex-col gap-8">
					{release.sections.map((section) => (
						<section key={section.title}>
							<h3 className="font-semibold text-base">{section.title}</h3>
							<ul className="mt-3 list-disc space-y-2.5 pl-6 text-pretty text-base/7 text-foreground marker:text-muted-foreground">
								{section.items.map((item) => (
									<li key={item} className="pl-1">
										{item}
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</div>
		</article>
	);
}

export default async function ChangelogPage() {
	const releases = await loadChangelogReleases();

	return (
		<div className="isolate min-h-dvh bg-background text-foreground antialiased">
			<ChangelogSeenTracker />
			<PublicPageHeader section="changelog" />
			<main className={cn(publicPageContainerClassName, "py-10 sm:py-14")}>
				<PublicPageIntro
					eyebrow="What’s new"
					title="Changelog"
					className="lg:ml-72"
				>
					New features, thoughtful improvements, and fixes in every release.
				</PublicPageIntro>
				<div className="mt-10 sm:mt-14">
					{releases.map((release) => (
						<Release
							key={release.version}
							release={release}
							latest={release.version === CHANGELOG_RELEASES[0].version}
						/>
					))}
				</div>
			</main>
		</div>
	);
}
