"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import { useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	invalidatePageNavigation,
	invalidatePages,
	invalidateTrash,
	listTrashQueryOptions,
	purgePageMutationOptions,
	restorePageMutationOptions,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";

export function TrashList({
	workspaceId,
	allowPurge = true,
}: {
	workspaceId: string;
	allowPurge?: boolean;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	// Viewers can see what's in the trash but not restore or purge.
	const canEdit = useCanEditWorkspace();
	const trashQuery = useQuery(listTrashQueryOptions(workspaceId));
	const restoreMutation = useMutation(restorePageMutationOptions());
	const purgeMutation = useMutation({
		...purgePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [purgeError, setPurgeError] = useState<string | null>(null);
	const [pageToPurge, setPageToPurge] = useState<{
		id: string;
		title: string | null;
	} | null>(null);

	const items = trashQuery.data?.items ?? [];

	async function refresh() {
		await Promise.all([
			invalidateTrash(queryClient),
			invalidatePages(queryClient),
			invalidatePageNavigation(queryClient, workspaceId),
			invalidateTasksWhenIdle(queryClient),
		]);
	}

	function confirmPurgePage() {
		if (!pageToPurge || purgeMutation.isPending) return;
		setPurgeError(null);
		purgeMutation.mutate(
			{ path: { id: pageToPurge.id } },
			{
				onSuccess: async () => {
					setPageToPurge(null);
					await refresh();
				},
				onError: (error) =>
					setPurgeError(
						userErrorMessage(error, "The page could not be deleted."),
					),
			},
		);
	}

	if (trashQuery.isPending) {
		return (
			<p className="text-base text-muted-foreground sm:text-sm">Loading…</p>
		);
	}

	if (trashQuery.isError && !trashQuery.data) {
		return (
			<div className="flex flex-wrap items-center gap-3 text-base sm:text-sm">
				<p role="alert" className="text-destructive">
					The trash could not be loaded.
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-12 text-base sm:h-8 sm:text-sm pointer-coarse:min-h-12"
					onClick={() => void trashQuery.refetch()}
				>
					Try again
				</Button>
			</div>
		);
	}

	if (items.length === 0) {
		return (
			<p className="text-base text-muted-foreground sm:text-sm">
				The trash is empty.
			</p>
		);
	}

	return (
		<>
			<ul aria-label="Deleted pages" className="flex flex-col divide-y">
				{items.map((page) => (
					<li key={page.id} className="@container py-4">
						<div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:gap-6">
							<div className="flex min-w-0 flex-1 items-start gap-3">
								{page.icon ? (
									<span
										className="mt-0.5 flex size-5 shrink-0 items-center justify-center @2xl:size-4"
										aria-hidden="true"
									>
										{page.icon}
									</span>
								) : (
									<FileTextIcon
										aria-hidden="true"
										className="mt-0.5 size-5 shrink-0 text-muted-foreground @2xl:size-4"
									/>
								)}
								<div className="min-w-0 flex-1">
									<p className="font-medium text-base leading-6 [overflow-wrap:anywhere] @2xl:text-sm">
										{page.title || "Untitled"}
									</p>
									{page.deletedAt ? (
										<p className="text-base text-muted-foreground leading-6 @2xl:text-sm">
											Deleted{" "}
											<time
												dateTime={page.deletedAt}
												title={new Date(page.deletedAt).toLocaleString()}
											>
												{new Date(page.deletedAt).toLocaleDateString(
													undefined,
													{ dateStyle: "medium" },
												)}
											</time>
										</p>
									) : null}
								</div>
							</div>
							{canEdit ? (
								<div className="flex flex-wrap gap-2 @2xl:shrink-0">
									<Button
										type="button"
										variant="secondary"
										size="sm"
										className="h-12 flex-1 gap-2 px-3 text-base @2xl:h-8 @2xl:flex-none @2xl:text-sm pointer-coarse:min-h-12"
										disabled={restoreMutation.isPending}
										onClick={() =>
											restoreMutation.mutate(
												{ path: { id: page.id } },
												{
													onSuccess: async (restored) => {
														await refresh();
														router.push(`/w/${workspaceId}/p/${restored.id}`);
													},
												},
											)
										}
									>
										<Undo2Icon aria-hidden="true" className="size-4" />
										Restore
									</Button>
									{allowPurge ? (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-12 flex-1 gap-2 px-3 text-base text-destructive hover:text-destructive @2xl:h-8 @2xl:flex-none @2xl:text-sm pointer-coarse:min-h-12"
											disabled={purgeMutation.isPending}
											onClick={() =>
												setPageToPurge({ id: page.id, title: page.title })
											}
										>
											<Trash2Icon aria-hidden="true" className="size-4" />
											Delete forever
										</Button>
									) : null}
								</div>
							) : null}
						</div>
					</li>
				))}
			</ul>
			<DestructiveConfirmationDialog
				open={pageToPurge !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPageToPurge(null);
						setPurgeError(null);
					}
				}}
				title="Delete forever?"
				description={
					<span className="break-words">
						This permanently deletes {pageToPurge?.title || "Untitled"} and
						everything inside it. This cannot be undone.
					</span>
				}
				actionLabel="Delete forever"
				pendingLabel="Deleting…"
				pending={purgeMutation.isPending}
				error={purgeError}
				onConfirm={confirmPurgePage}
			/>
		</>
	);
}
