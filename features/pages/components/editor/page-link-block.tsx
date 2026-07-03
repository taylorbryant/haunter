"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { listPagesQueryOptions } from "@/features/pages/client/queries";

function PageLink({
	pageId,
	workspaceId,
}: {
	pageId: string;
	workspaceId: string;
}) {
	// Shares the sidebar tree's query, so renames update the link live.
	const pagesQuery = useQuery(listPagesQueryOptions(workspaceId));
	const page = pagesQuery.data?.items.find((item) => item.id === pageId);

	if (pagesQuery.isPending) {
		return (
			<span className="inline-flex items-center gap-1.5 py-0.5 text-muted-foreground">
				<FileTextIcon className="size-4" />…
			</span>
		);
	}

	if (!page) {
		return (
			<span className="inline-flex items-center gap-1.5 py-0.5 text-muted-foreground line-through">
				<FileTextIcon className="size-4" />
				Page unavailable (deleted or in trash)
			</span>
		);
	}

	return (
		<Link
			href={`/w/${workspaceId}/p/${pageId}`}
			className="inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 font-medium underline decoration-muted-foreground/50 underline-offset-4 hover:bg-muted"
		>
			<FileTextIcon className="size-4 shrink-0" />
			<span className="truncate">
				{page.icon ? `${page.icon} ` : ""}
				{page.title || "Untitled"}
			</span>
		</Link>
	);
}

export const pageLinkBlockSpec = createReactBlockSpec(
	{
		type: "pageLink",
		propSchema: {
			pageId: { default: "" },
			workspaceId: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ block }) => {
			const { pageId, workspaceId } = block.props;

			return (
				<div className="w-full" contentEditable={false}>
					{pageId === "" ? (
						<span className="text-muted-foreground text-sm">
							Creating page…
						</span>
					) : (
						<PageLink pageId={pageId} workspaceId={workspaceId} />
					)}
				</div>
			);
		},
	},
);
