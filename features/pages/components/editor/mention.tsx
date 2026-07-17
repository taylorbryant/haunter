"use client";

import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listPagesQueryOptions } from "@/features/pages/client/queries";

function MentionChip({
	pageId,
	workspaceId,
}: {
	pageId: string;
	workspaceId: string;
}) {
	// Shares the sidebar tree's query, so renames update mentions live.
	const pagesQuery = useQuery(listPagesQueryOptions(workspaceId));
	const page = pagesQuery.data?.items.find((item) => item.id === pageId);

	if (!page) {
		return (
			<span className="text-muted-foreground line-through">
				{pagesQuery.isPending
					? "…"
					: pagesQuery.isError
						? "Page temporarily unavailable"
						: "Page unavailable"}
			</span>
		);
	}

	return (
		<Link
			href={`/w/${workspaceId}/p/${pageId}`}
			className="rounded px-0.5 font-medium underline decoration-muted-foreground/50 underline-offset-4 hover:bg-muted"
		>
			{page.icon ? `${page.icon} ` : ""}
			{page.title || "Untitled"}
		</Link>
	);
}

/** Inline @-mention of another page; rendered as a live-titled link. */
export const mentionSpec = createReactInlineContentSpec(
	{
		type: "mention",
		propSchema: {
			pageId: { default: "" },
			workspaceId: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent }) => (
			<MentionChip
				pageId={inlineContent.props.pageId}
				workspaceId={inlineContent.props.workspaceId}
			/>
		),
	},
);
