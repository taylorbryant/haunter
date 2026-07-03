"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
	const trashQuery = useQuery(listTrashQueryOptions(workspaceId));
	const restoreMutation = useMutation(restorePageMutationOptions());
	const purgeMutation = useMutation(purgePageMutationOptions());

	const items = trashQuery.data?.items ?? [];

	async function refresh() {
		await Promise.all([
			invalidateTrash(queryClient),
			invalidatePages(queryClient),
			invalidateTasks(queryClient),
		]);
	}

	if (trashQuery.isPending) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	if (items.length === 0) {
		return <p className="text-muted-foreground text-sm">The trash is empty.</p>;
	}

	return (
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
						onClick={() => {
							if (
								!window.confirm(
									`Permanently delete "${page.title || "Untitled"}" and everything inside it? This cannot be undone.`,
								)
							) {
								return;
							}
							purgeMutation.mutate(
								{ path: { id: page.id } },
								{ onSuccess: refresh },
							);
						}}
					>
						<Trash2Icon className="size-3.5" />
						Delete forever
					</Button>
				</li>
			))}
		</ul>
	);
}
