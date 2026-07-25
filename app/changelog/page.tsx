import type { Metadata } from "next";
import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangelogSeenTracker } from "@/features/changelog/components/changelog-seen-tracker";
import {
	type ChangelogRelease,
	loadChangelogReleases,
} from "@/features/changelog/content";
import { CHANGELOG_RELEASES } from "@/features/changelog/releases";

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
		<article className="grid gap-6 border-border/70 border-t py-10 first:border-t-0 first:pt-0 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-10 md:py-14">
			<div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
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
			<div className="min-w-0">
				<h2 className="text-balance font-semibold text-2xl tracking-tight">
					{release.title}
				</h2>
				<div className="mt-8 flex flex-col gap-8">
					{release.sections.map((section) => (
						<section key={section.title}>
							<h3 className="font-semibold text-base">{section.title}</h3>
							<ul className="mt-3 list-disc space-y-2 pl-5 text-pretty text-muted-foreground">
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
		<div className="min-h-dvh bg-background">
			<ChangelogSeenTracker />
			<header className="border-border/70 border-b">
				<div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
					<Link
						href="/"
						className="flex items-center gap-2 font-medium text-sm"
					>
						<span aria-hidden>
							<GhostLogo className="size-5" />
						</span>
						Haunter
					</Link>
					<Button
						size="sm"
						variant="outline"
						nativeButton={false}
						render={<Link href="/" />}
					>
						Open Haunter
					</Button>
				</div>
			</header>
			<main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
				<div className="max-w-2xl">
					<p className="font-medium text-muted-foreground text-sm">
						What’s new
					</p>
					<h1 className="mt-3 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
						Changelog
					</h1>
					<p className="mt-4 max-w-[60ch] text-pretty text-base text-muted-foreground sm:text-lg">
						New features, thoughtful improvements, and fixes in every release.
					</p>
				</div>
				<div className="mt-14 sm:mt-16">
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
