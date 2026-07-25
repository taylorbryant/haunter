"use client";

import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { ChangelogSeenTracker } from "@/features/changelog/components/changelog-seen-tracker";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { useIsMobile } from "@/hooks/use-mobile";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "long",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

function formatReleaseDate(date: string) {
	return dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

function ReleaseList({
	releases,
	onSelect,
}: {
	releases: readonly ChangelogRelease[];
	onSelect: (version: string) => void;
}) {
	return (
		<div className="divide-y divide-border/70">
			{releases.map((release, index) => (
				<button
					key={release.version}
					type="button"
					className="flex w-full flex-col gap-3 p-4 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/50 sm:p-5"
					onClick={() => onSelect(release.version)}
				>
					<div className="flex w-full min-w-0 items-start justify-between gap-3">
						<div className="min-w-0">
							<h2 className="text-pretty font-semibold text-lg sm:text-base">
								{release.title}
							</h2>
							<p className="text-base text-muted-foreground tabular-nums sm:text-sm">
								{formatReleaseDate(release.date)}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Badge variant="secondary" className="font-mono tabular-nums">
								v{release.version}
							</Badge>
							{index === 0 ? <Badge>Latest</Badge> : null}
						</div>
					</div>
					<p className="line-clamp-2 text-pretty text-base text-muted-foreground sm:text-sm">
						{release.sections[0]?.items[0]}
					</p>
				</button>
			))}
		</div>
	);
}

function ReleaseDetail({
	release,
	latest,
}: {
	release: ChangelogRelease;
	latest: boolean;
}) {
	return (
		<article className="flex flex-col gap-8 p-5 sm:p-6">
			<header className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="font-mono tabular-nums">
						v{release.version}
					</Badge>
					{latest ? <Badge>Latest</Badge> : null}
					<p className="text-base text-muted-foreground tabular-nums sm:text-sm">
						{formatReleaseDate(release.date)}
					</p>
				</div>
				<h2 className="text-balance font-semibold text-2xl tracking-tight">
					{release.title}
				</h2>
			</header>
			<div className="flex flex-col gap-8">
				{release.sections.map((section) => (
					<section key={section.title} className="flex flex-col gap-3">
						<h3 className="font-semibold text-lg sm:text-base">
							{section.title}
						</h3>
						<ul className="flex list-disc flex-col gap-2 pl-5 text-pretty text-base text-muted-foreground sm:text-sm">
							{section.items.map((item) => (
								<li key={item} className="pl-1">
									{item}
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</article>
	);
}

function ChangelogContent({
	releases,
	selectedVersion,
	onSelect,
}: {
	releases: readonly ChangelogRelease[];
	selectedVersion: string | null;
	onSelect: (version: string) => void;
}) {
	const selectedRelease =
		releases.find((release) => release.version === selectedVersion) ?? null;

	if (selectedRelease) {
		return (
			<ReleaseDetail
				release={selectedRelease}
				latest={selectedRelease.version === releases[0]?.version}
			/>
		);
	}

	return <ReleaseList releases={releases} onSelect={onSelect} />;
}

function TouchTarget() {
	return (
		<span
			className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
			aria-hidden
		/>
	);
}

export function ChangelogDialog({
	open,
	onOpenChange,
	releases,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	releases: readonly ChangelogRelease[];
}) {
	const isMobile = useIsMobile();
	const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
	const hasSelection = selectedVersion !== null;

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) setSelectedVersion(null);
		onOpenChange(nextOpen);
	}

	const content = (
		<ChangelogContent
			releases={releases}
			selectedVersion={selectedVersion}
			onSelect={setSelectedVersion}
		/>
	);

	if (isMobile) {
		return (
			<Drawer showSwipeHandle open={open} onOpenChange={handleOpenChange}>
				<DrawerContent className="h-[85dvh]">
					<ChangelogSeenTracker enabled={open} />
					<DrawerHeader className="border-border/70 border-b p-2">
						<div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2">
							{hasSelection ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="relative"
									onClick={() => setSelectedVersion(null)}
								>
									<ArrowLeftIcon />
									<TouchTarget />
									<span className="sr-only">Back to releases</span>
								</Button>
							) : (
								<span aria-hidden />
							)}
							<DrawerTitle className="text-center">Changelog</DrawerTitle>
							<DrawerClose
								render={
									<Button variant="ghost" size="icon-sm" className="relative" />
								}
							>
								<XIcon />
								<TouchTarget />
								<span className="sr-only">Close</span>
							</DrawerClose>
						</div>
						<DrawerDescription className="sr-only">
							New features, improvements, and fixes in Haunter.
						</DrawerDescription>
					</DrawerHeader>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
						{content}
					</div>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="flex h-[min(36rem,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
			>
				<ChangelogSeenTracker enabled={open} />
				<div className="grid shrink-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 border-border/70 border-b p-2">
					{hasSelection ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setSelectedVersion(null)}
						>
							<ArrowLeftIcon />
							<span className="sr-only">Back to releases</span>
						</Button>
					) : (
						<span aria-hidden />
					)}
					<DialogTitle className="text-center">Changelog</DialogTitle>
					<DialogClose render={<Button variant="ghost" size="icon-sm" />}>
						<XIcon />
						<span className="sr-only">Close</span>
					</DialogClose>
				</div>
				<DialogDescription className="sr-only">
					New features, improvements, and fixes in Haunter.
				</DialogDescription>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{content}
				</div>
			</DialogContent>
		</Dialog>
	);
}
