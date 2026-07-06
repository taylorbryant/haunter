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
			// Match the "Linked mentions" backlink style: neutral foreground text
			// with a muted icon. The color lives on the text span, not the anchor —
			// the editor's default (blue) link color out-cascades a color set on
			// the <a> itself, but a plain child span overrides cleanly.
			className="haunter-page-link inline-flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted"
		>
			<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="truncate font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4">
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
