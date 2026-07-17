"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { listBacklinksQueryOptions } from "@/features/pages/client/queries";

/** Notion-style "Linked mentions": live pages whose documents link here. */
export function Backlinks({ pageId }: { pageId: string }) {
	const backlinksQuery = useQuery(listBacklinksQueryOptions(pageId));
	const items = backlinksQuery.data?.items ?? [];

	if (backlinksQuery.isError && !backlinksQuery.data) {
		return (
			<div className="mt-10 flex items-center gap-2 border-t pt-4 text-xs">
				<p role="alert" className="text-destructive">
					Linked mentions could not be loaded.
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => void backlinksQuery.refetch()}
				>
					Try again
				</Button>
			</div>
		);
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<section className="mt-10 border-t pt-4">
			<h2 className="mb-2 font-medium text-muted-foreground text-xs">
				Linked mentions
			</h2>
			<ul className="flex flex-col gap-0.5">
				{items.map((item) => (
					<li key={item.id}>
						<Link
							href={`/w/${item.workspaceId}/p/${item.id}`}
							className="flex items-center gap-1.5 rounded px-1 py-1 text-sm hover:bg-muted"
						>
							{item.icon ? (
								<span
									className="flex size-4 shrink-0 items-center justify-center"
									aria-hidden="true"
								>
									{item.icon}
								</span>
							) : (
								<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
							)}
							<span className="truncate font-medium underline decoration-muted-foreground/40 underline-offset-4">
								{item.title || "Untitled"}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
