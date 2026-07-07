"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	invalidatePages,
	invalidateTrash,
	listTrashQueryOptions,
	purgePageMutationOptions,
	restorePageMutationOptions,
} from "@/features/pages/client/queries";
import { invalidateTasks } from "@/features/tasks/client/queries";

export function TrashList({ workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	// Viewers can see what's in the trash but not restore or purge.
	const canEdit = useCanEditWorkspace();
	const trashQuery = useQuery(listTrashQueryOptions(workspaceId));
	const restoreMutation = useMutation(restorePageMutationOptions());
	const purgeMutation = useMutation(purgePageMutationOptions());
	const [pageToPurge, setPageToPurge] = useState<{
		id: string;
		title: string | null;
	} | null>(null);

	const items = trashQuery.data?.items ?? [];

	async function refresh() {
		await Promise.all([
			invalidateTrash(queryClient),
			invalidatePages(queryClient),
			invalidateTasks(queryClient),
		]);
	}

	function confirmPurgePage() {
		if (!pageToPurge || purgeMutation.isPending) return;
		purgeMutation.mutate(
			{ path: { id: pageToPurge.id } },
			{
				onSuccess: async () => {
					setPageToPurge(null);
					await refresh();
				},
			},
		);
	}

	if (trashQuery.isPending) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	if (items.length === 0) {
		return <p className="text-muted-foreground text-sm">The trash is empty.</p>;
	}

	return (
		<>
			<ul className="flex flex-col divide-y">
				{items.map((page) => (
					<li key={page.id} className="flex items-center gap-3 py-2">
						<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm">
								{page.icon ? `${page.icon} ` : ""}
								{page.title || "Untitled"}
							</p>
							{page.deletedAt ? (
								<p className="text-muted-foreground text-xs">
									Deleted {new Date(page.deletedAt).toLocaleString()}
								</p>
							) : null}
						</div>
						{canEdit ? (
							<>
								<Button
									type="button"
									variant="ghost"
									size="sm"
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
									<Undo2Icon className="size-3.5" />
									Restore
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={purgeMutation.isPending}
									onClick={() =>
										setPageToPurge({ id: page.id, title: page.title })
									}
								>
									<Trash2Icon className="size-3.5" />
									Delete forever
								</Button>
							</>
						) : null}
					</li>
				))}
			</ul>
			<DestructiveConfirmationDialog
				open={pageToPurge !== null}
				onOpenChange={(open) => {
					if (!open) setPageToPurge(null);
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
				onConfirm={confirmPurgePage}
			/>
		</>
	);
}
