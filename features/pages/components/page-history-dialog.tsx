"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	getPageVersionQueryOptions,
	invalidatePage,
	invalidatePages,
	invalidatePageVersions,
	listPageVersionsQueryOptions,
	restorePageVersionMutationOptions,
} from "@/features/pages/client/queries";
import { invalidateTasks } from "@/features/tasks/client/queries";
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

/**
 * Header "History" control: browse a page's checkpoints, preview any of
 * them read-only, and restore. Rendered on page routes for members who can
 * edit (restores are editor-gated server-side regardless).
 */
export function PageHistoryButton() {
	const pathname = usePathname();
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const canEdit = useCanEditWorkspace();
	const [open, setOpen] = useState(false);

	if (!pageId || !canEdit) return null;

	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="text-muted-foreground"
				onClick={() => setOpen(true)}
			>
				<HistoryIcon />
				<span className="sr-only sm:not-sr-only">History</span>
			</Button>
			{open ? (
				<PageHistoryDialog pageId={pageId} onOpenChange={setOpen} />
			) : null}
		</>
	);
}

function PageHistoryDialog({
	pageId,
	onOpenChange,
}: {
	pageId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const versionsQuery = useQuery(listPageVersionsQueryOptions(pageId));
	const versions = versionsQuery.data?.items ?? [];
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId ?? versions[0]?.id ?? null;

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
				onSuccess: async () => {
					await Promise.all([
						invalidatePage(queryClient, pageId),
						invalidatePages(queryClient),
						invalidatePageVersions(queryClient, pageId),
						invalidateTasks(queryClient),
					]);
					onOpenChange(false);
					// The open editor initializes once; a hard reload is the
					// simplest way to guarantee it picks up the restored doc.
					window.location.reload();
				},
			},
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
				) : versions.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No versions yet — they appear after you've edited for a while.
					</p>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
						{/* Phones get a horizontal checkpoint strip above the preview;
						    the side-by-side list only fits from sm: up. */}
						<div className="flex shrink-0 gap-1 overflow-x-auto sm:w-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto">
							{versions.map((version) => (
								<button
									key={version.id}
									type="button"
									onClick={() => setSelectedId(version.id)}
									className={cn(
										"flex shrink-0 flex-col whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted sm:shrink sm:whitespace-normal",
										version.id === selected && "bg-muted",
									)}
								>
									<span>{formatWhen(version.createdAt)}</span>
									<span className="text-muted-foreground text-xs">
										{version.cause === "restore"
											? "Before a restore"
											: "Checkpoint"}
										{version.createdByName ? ` · ${version.createdByName}` : ""}
									</span>
								</button>
							))}
						</div>
						<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
							<div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
								{previewQuery.isPending ? (
									<Skeleton className="h-40 w-full" />
								) : previewQuery.data ? (
									<ReadOnlyEditor
										key={selected}
										content={previewQuery.data.content}
									/>
								) : (
									<p className="text-muted-foreground text-sm">
										This version could not be loaded.
									</p>
								)}
							</div>
							<Button
								className="w-full sm:w-fit"
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
