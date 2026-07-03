"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
	getPageQueryOptions,
	invalidatePages,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import { setPageSaveState } from "@/features/pages/client/save-state";
import { Backlinks } from "./backlinks";
import { PageIconButton } from "./page-icon-picker";

const HaunterEditor = dynamic(() => import("./editor/haunter-editor"), {
	ssr: false,
	loading: () => (
		<div className="flex flex-col gap-3 px-1 py-2" aria-hidden>
			<div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
			<div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
			<div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
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
			<div className="mx-auto w-full max-w-4xl px-8 py-10">
				<div className="mx-[54px] mb-8 h-10 w-1/2 animate-pulse rounded bg-muted" />
			</div>
		);
	}

	if (pageQuery.isError || !pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl px-8 py-10 text-muted-foreground">
				<p className="px-[54px]">This page could not be loaded.</p>
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
				{ onSuccess: () => invalidatePages(queryClient) },
			);
		}, TITLE_SAVE_DELAY_MS);
	}

	return (
		<div className="mx-auto w-full max-w-4xl px-8 py-10">
			{/* BlockNote insets its content 54px (.bn-editor padding-inline) to
			    make a gutter for the block controls; pad the title and its icon
			    to the same column so they align with block text, Notion-style. */}
			<div className="group/header">
				<div className="mb-1 px-[54px]">
					<PageIconButton pageId={pageId} icon={page.icon} />
				</div>
				<div className="mb-2 px-[54px]">
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
			<div className="px-[54px]">
				<Backlinks pageId={pageId} />
			</div>
		</div>
	);
}
