"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
	getPageQueryOptions,
	invalidatePages,
	setPageSavedAtInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import { setPageSaveState } from "@/features/pages/client/save-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Backlinks } from "./backlinks";
import { PageIconButton } from "./page-icon-picker";

/**
 * Body placeholder shaped like a couple of paragraphs. Uses the editor's text
 * column inset (54px on desktop, flush on mobile) so it lines up with the real
 * content, and is shared by the data-loading and editor-chunk-loading states
 * so the two skeletons look identical.
 */
function EditorBodySkeleton() {
	return (
		<div className="flex flex-col gap-3 px-0 md:px-[54px]" aria-hidden>
			<Skeleton className="h-4 w-11/12" />
			<Skeleton className="h-4 w-4/5" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="mt-5 h-4 w-3/4" />
			<Skeleton className="h-4 w-5/6" />
			<Skeleton className="h-4 w-2/5" />
		</div>
	);
}

const HaunterEditor = dynamic(() => import("./editor/haunter-editor"), {
	ssr: false,
	loading: () => (
		<div className="py-2">
			<EditorBodySkeleton />
		</div>
	),
});

const TITLE_SAVE_DELAY_MS = 500;

export function PageEditor({ pageId }: { pageId: string }) {
	const queryClient = useQueryClient();
	const pageQuery = useQuery(getPageQueryOptions(pageId));
	const updatePageMutation = useMutation(updatePageMutationOptions());

	const [title, setTitle] = useState<string | null>(null);
	const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reset local title state when navigating between pages.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change
	useEffect(() => {
		setTitle(null);
		setPageSaveState("saved");
	}, [pageId]);

	if (pageQuery.isPending) {
		return (
			<div
				className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10"
				aria-hidden
			>
				<div className="mb-3 px-0 md:px-[54px]">
					<Skeleton className="size-10 rounded-lg" />
				</div>
				<div className="mb-6 px-0 md:px-[54px]">
					<Skeleton className="h-9 w-1/2 max-w-xs" />
				</div>
				<EditorBodySkeleton />
			</div>
		);
	}

	if (pageQuery.isError || !pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10 text-muted-foreground">
				<p className="px-0 md:px-[54px]">This page could not be loaded.</p>
			</div>
		);
	}

	const page = pageQuery.data;
	const shownTitle = title ?? page.title;

	function handleTitleChange(next: string) {
		setTitle(next);
		if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
		titleTimeoutRef.current = setTimeout(() => {
			updatePageMutation.mutate(
				{ path: { id: pageId }, body: { title: next } },
				{
					onSuccess: (result) => {
						setPageSavedAtInCache(queryClient, pageId, result.updatedAt);
						invalidatePages(queryClient);
					},
				},
			);
		}, TITLE_SAVE_DELAY_MS);
	}

	return (
		<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
			{/* BlockNote insets its content 54px (.bn-editor padding-inline) to
			    make a gutter for the block controls; pad the title and its icon
			    to the same column so they align with block text, Notion-style. */}
			<div className="group/header">
				<div className="mb-1 px-0 md:px-[54px]">
					<PageIconButton pageId={pageId} icon={page.icon} />
				</div>
				<div className="mb-2 px-0 md:px-[54px]">
					<input
						className="w-full border-none bg-transparent font-bold text-3xl outline-none placeholder:text-muted-foreground/60"
						value={shownTitle}
						placeholder="Untitled"
						onChange={(event) => handleTitleChange(event.target.value)}
						aria-label="Page title"
					/>
				</div>
			</div>
			<HaunterEditor
				key={pageId}
				pageId={pageId}
				workspaceId={page.workspaceId}
				initialContent={page.content}
				onSaveStateChange={setPageSaveState}
			/>
			{/* Same 54px inset as the editor content column. */}
			<div className="px-0 md:px-[54px]">
				<Backlinks pageId={pageId} />
			</div>
		</div>
	);
}
