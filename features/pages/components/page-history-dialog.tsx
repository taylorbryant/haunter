"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import {
	getPageVersionQueryOptions,
	invalidateBacklinks,
	invalidatePage,
	invalidatePages,
	invalidatePageVersions,
	listPageVersionsQueryOptions,
	restorePageVersionMutationOptions,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ReadOnlyEditor = dynamic(() => import("./editor/read-only-editor"), {
	ssr: false,
	loading: () => <Skeleton className="h-40 w-full" />,
});

function formatWhen(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function versionSubtext(version: {
	cause: string;
	createdByName?: string | null;
}) {
	const cause = version.cause === "restore" ? "Before a restore" : "Checkpoint";
	return version.createdByName ? `${cause} · ${version.createdByName}` : cause;
}

export function PageHistoryDialog({
	pageId,
	onOpenChange,
}: {
	pageId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const isMobile = useIsMobile();
	const queryClient = useQueryClient();
	const versionsQuery = useQuery(listPageVersionsQueryOptions(pageId));
	const versions = versionsQuery.data?.items ?? [];
	// Mobile is a two-step flow (list → preview), so nothing is selected
	// until a version is tapped; desktop previews the newest right away.
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = isMobile
		? selectedId
		: (selectedId ?? versions[0]?.id ?? null);
	const selectedVersion = versions.find((v) => v.id === selected) ?? null;

	const previewQuery = useQuery({
		...getPageVersionQueryOptions(pageId, selected ?? ""),
		enabled: selected !== null,
	});
	const restoreMutation = useMutation(restorePageVersionMutationOptions());

	function restore() {
		if (!selected || restoreMutation.isPending) return;
		restoreMutation.mutate(
			{ path: { id: pageId, versionId: selected }, body: {} },
			{
				onSuccess: async (result) => {
					const invalidations = [
						invalidatePage(queryClient, pageId),
						invalidatePages(queryClient),
						invalidatePageVersions(queryClient, pageId),
					];
					if (result.tasksChanged) {
						invalidations.push(invalidateTasksWhenIdle(queryClient));
					}
					if (result.linksChanged) {
						invalidations.push(invalidateBacklinks(queryClient));
					}
					await Promise.all(invalidations);
					onOpenChange(false);
					// The open editor initializes once; a hard reload is the
					// simplest way to guarantee it picks up the restored doc.
					window.location.reload();
				},
			},
		);
	}

	const preview = previewQuery.isPending ? (
		<Skeleton className="h-40 w-full" />
	) : previewQuery.isError && !previewQuery.data ? (
		<div className="flex items-center gap-2 text-sm">
			<p role="alert" className="text-destructive">
				This version could not be loaded.
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => void previewQuery.refetch()}
			>
				Try again
			</Button>
		</div>
	) : previewQuery.data ? (
		<ReadOnlyEditor key={selected} content={previewQuery.data.content} />
	) : (
		<p className="text-muted-foreground text-sm">
			This version could not be loaded.
		</p>
	);

	if (isMobile) {
		return (
			<Drawer showSwipeHandle open onOpenChange={onOpenChange}>
				<DrawerContent className="h-[85dvh]">
					{selected === null ? (
						<>
							<DrawerHeader>
								<DrawerTitle>History</DrawerTitle>
								<DrawerDescription>
									Checkpoints are saved automatically as you edit.
								</DrawerDescription>
							</DrawerHeader>
							<div className="min-h-0 flex-1 overflow-y-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
								{versionsQuery.isPending ? (
									<div className="flex flex-col gap-2 p-2">
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
									</div>
								) : versionsQuery.isError && !versionsQuery.data ? (
									<div className="flex items-center gap-2 p-2 text-sm">
										<p role="alert" className="text-destructive">
											Page history could not be loaded.
										</p>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => void versionsQuery.refetch()}
										>
											Try again
										</Button>
									</div>
								) : versions.length === 0 ? (
									<p className="p-2 text-muted-foreground text-sm">
										No versions yet — they appear after you've edited for a
										while.
									</p>
								) : (
									versions.map((version) => (
										<button
											key={version.id}
											type="button"
											className="flex w-full flex-col rounded-md px-3 py-2.5 text-left hover:bg-muted"
											onClick={() => setSelectedId(version.id)}
										>
											<span className="text-sm">
												{formatWhen(version.createdAt)}
											</span>
											<span className="text-muted-foreground text-xs">
												{versionSubtext(version)}
											</span>
										</button>
									))
								)}
							</div>
						</>
					) : (
						<>
							<DrawerHeader className="relative">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="-translate-y-1/2 absolute top-1/2 left-2 text-muted-foreground"
									onClick={() => setSelectedId(null)}
								>
									<ChevronLeftIcon />
									Back
								</Button>
								<DrawerTitle>
									{selectedVersion ? formatWhen(selectedVersion.createdAt) : ""}
								</DrawerTitle>
								<DrawerDescription>
									{selectedVersion ? versionSubtext(selectedVersion) : ""}
								</DrawerDescription>
							</DrawerHeader>
							{/* editor-flush drops BlockNote's 54px inline gutter (see
							    globals.css) so the preview uses the full drawer width. */}
							<div className="editor-flush mt-3 min-h-0 flex-1 overflow-y-auto border-t p-4">
								{preview}
							</div>
							<DrawerFooter className="pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
								<Button disabled={restoreMutation.isPending} onClick={restore}>
									{restoreMutation.isPending
										? "Restoring…"
										: "Restore this version"}
								</Button>
							</DrawerFooter>
						</>
					)}
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[80dvh] flex-col gap-3 sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Page history</DialogTitle>
					<DialogDescription>
						Checkpoints are saved automatically as you edit. Restoring keeps the
						current state in history too.
					</DialogDescription>
				</DialogHeader>
				{versionsQuery.isPending ? (
					<Skeleton className="h-40 w-full" />
				) : versionsQuery.isError && !versionsQuery.data ? (
					<div className="flex items-center gap-2 text-sm">
						<p role="alert" className="text-destructive">
							Page history could not be loaded.
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void versionsQuery.refetch()}
						>
							Try again
						</Button>
					</div>
				) : versions.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No versions yet — they appear after you've edited for a while.
					</p>
				) : (
					<div className="flex min-h-0 flex-1 gap-4">
						<div className="flex w-56 shrink-0 flex-col overflow-y-auto">
							{versions.map((version) => (
								<button
									key={version.id}
									type="button"
									onClick={() => setSelectedId(version.id)}
									className={cn(
										"flex shrink flex-col rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
										version.id === selected && "bg-muted",
									)}
								>
									<span>{formatWhen(version.createdAt)}</span>
									<span className="text-muted-foreground text-xs">
										{versionSubtext(version)}
									</span>
								</button>
							))}
						</div>
						<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
							<div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
								{preview}
							</div>
							<Button
								className="w-fit"
								disabled={!selected || restoreMutation.isPending}
								onClick={restore}
							>
								{restoreMutation.isPending
									? "Restoring…"
									: "Restore this version"}
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
