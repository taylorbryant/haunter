import { ChevronDownIcon } from "lucide-react";
import type { Metadata } from "next";
import {
	PublicPageHeader,
	PublicPageIntro,
	publicPageContainerClassName,
	publicPageViewport,
} from "@/components/public-page";
import { ChangelogSeenTracker } from "@/features/changelog/components/changelog-seen-tracker";
import { loadChangelogReleases } from "@/features/changelog/content";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { cn } from "@/lib/utils";

export const viewport = publicPageViewport;
export const metadata: Metadata = {
	title: "Changelog · Haunter",
	description: "New features, improvements, and fixes in Haunter.",
};
export const dynamic = "force-static";
const dateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "long",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

function ReleaseDate({ release }: { release: ChangelogRelease }) {
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground tabular-nums sm:text-sm">
			<time dateTime={release.date}>
				{dateFormatter.format(new Date(`${release.date}T00:00:00.000Z`))}
			</time>
			<span aria-hidden>·</span>
			<span className="font-mono">v{release.version}</span>
		</span>
	);
}

function ReleaseSections({ release }: { release: ChangelogRelease }) {
	return (
		<div className="flex flex-col gap-7">
			{release.sections.map((section) => (
				<section key={section.title}>
					<h3 className="font-medium">{section.title}</h3>
					<ul className="mt-3 list-disc space-y-2 pl-5 text-pretty text-base/7 text-muted-foreground marker:text-muted-foreground">
						{section.items.map((item) => (
							<li key={item} className="pl-1">
								{item}
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

export default async function ChangelogPage() {
	const [latest, ...earlier] = await loadChangelogReleases();
	return (
		<div className="isolate min-h-dvh bg-background text-foreground antialiased">
			<ChangelogSeenTracker />
			<PublicPageHeader section="changelog" />
			<main
				id="changelog-content"
				tabIndex={-1}
				className={cn(
					publicPageContainerClassName,
					"scroll-mt-36 py-10 outline-none sm:scroll-mt-24 sm:py-14",
				)}
			>
				<div className="mx-auto max-w-3xl">
					<PublicPageIntro title="Changelog">
						New features, improvements, and fixes.
					</PublicPageIntro>
					{latest ? (
						<article
							aria-labelledby="latest-release"
							className="mt-10 border-foreground/10 border-t pt-8"
						>
							<header className="mb-8 flex flex-col gap-3">
								<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
									<ReleaseDate release={latest} />
									<span className="text-base text-primary sm:text-sm">
										Latest release
									</span>
								</div>
								<h2
									id="latest-release"
									className="text-balance font-medium text-2xl tracking-tight sm:text-3xl"
								>
									{latest.title}
								</h2>
							</header>
							<ReleaseSections release={latest} />
						</article>
					) : null}
					<section aria-labelledby="earlier-releases" className="mt-14">
						<h2 id="earlier-releases" className="mb-5 font-medium text-lg">
							Earlier releases
						</h2>
						<div className="divide-y divide-foreground/10 border-foreground/10 border-y">
							{earlier.map((release) => (
								<details key={release.version} className="group">
									<summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
										<span className="flex flex-col gap-2">
											<span className="text-pretty font-medium group-open:text-primary">
												{release.title}
											</span>
											<ReleaseDate release={release} />
										</span>
										<ChevronDownIcon
											aria-hidden
											className="size-4 shrink-0 text-muted-foreground group-open:rotate-180"
										/>
									</summary>
									<div className="pb-8">
										<ReleaseSections release={release} />
									</div>
								</details>
							))}
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}
