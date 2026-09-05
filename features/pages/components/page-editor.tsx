"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	getPageQueryOptions,
	recordPageViewMutationOptions,
	syncRecordedPageViewInNavigationCache,
} from "@/features/pages/client/queries";
import { setPageSaveState } from "@/features/pages/client/save-state";
import { cn } from "@/lib/utils";
import { Backlinks } from "./backlinks";
import { EditorBodySkeleton, PageEditorSkeleton } from "./page-editor-skeleton";
import { PageIconButton } from "./page-icon-picker";
import { PageTitleField } from "./page-title-field";

const HaunterEditor = dynamic(() => import("./editor/haunter-editor"), {
	ssr: false,
	loading: () => (
		<div className="py-2">
			<EditorBodySkeleton />
		</div>
	),
});

export function PageEditor({ pageId }: { pageId: string }) {
	const queryClient = useQueryClient();
	const pageQuery = useQuery(getPageQueryOptions(pageId));
	const recordViewMutation = useMutation({
		...recordPageViewMutationOptions(),
		meta: { errorMode: "silent" },
	});
	// Viewers get a read-only surface; the server denies their writes anyway,
	// but the UI must not pretend edits will stick.
	const readOnly = !useCanEditWorkspace();
	const currentUser = useCurrentUser();
	const [editorFocusRequest, setEditorFocusRequest] = useState(0);
	const recordedViewPageIdRef = useRef<string | null>(null);
	// Reset the shared header state when navigating between pages.
	// biome-ignore lint/correctness/useExhaustiveDependencies: page navigation owns this reset
	useEffect(() => {
		setPageSaveState("saved");
	}, [pageId]);

	useEffect(() => {
		const page = pageQuery.data;
		if (!page || recordedViewPageIdRef.current === page.id) return;
		recordedViewPageIdRef.current = page.id;
		void recordViewMutation
			.mutateAsync({ path: { id: page.id }, body: {} })
			.then(({ lastViewedAt }) =>
				syncRecordedPageViewInNavigationCache(
					queryClient,
					page.workspaceId,
					page,
					lastViewedAt,
				),
			)
			.catch(() => {
				// Allow a later remount to retry; navigation history must never
				// interfere with loading or editing the page.
				if (recordedViewPageIdRef.current === page.id) {
					recordedViewPageIdRef.current = null;
				}
			});
	}, [pageQuery.data, queryClient, recordViewMutation.mutateAsync]);

	if (pageQuery.isPending) {
		return <PageEditorSkeleton />;
	}

	if (!pageQuery.data) {
		return (
			<div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6 text-muted-foreground md:px-8 md:py-10">
				<p className="px-0 md:px-[54px]">This page could not be loaded.</p>
				<div className="px-0 md:px-[54px]">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void pageQuery.refetch()}
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	const page = pageQuery.data;

	return (
		<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
			{/* BlockNote insets its content 54px (.bn-editor padding-inline) to
			    make a gutter for the block controls; pad the title and its icon
			    to the same column so they align with block text, Notion-style. */}
			<div className="group/header">
				<div
					className={cn(
						"mb-1 px-0 md:px-[54px]",
						readOnly && "pointer-events-none",
					)}
				>
					<PageIconButton pageId={pageId} icon={page.icon} />
				</div>
				<div className="mb-2 px-0 md:px-[54px]">
					<PageTitleField
						key={`${currentUser?.id ?? "anonymous"}:${page.id}`}
						page={page}
						currentUserId={currentUser?.id ?? null}
						readOnly={readOnly}
						onFocusEditor={() => setEditorFocusRequest((count) => count + 1)}
					/>
				</div>
			</div>
			<HaunterEditor
				key={`${currentUser?.id ?? "anonymous"}:${pageId}`}
				pageId={pageId}
				workspaceId={page.workspaceId}
				initialContent={page.content}
				contentUpdatedAt={page.contentUpdatedAt}
				editable={!readOnly}
				focusRequest={editorFocusRequest}
				currentUserId={currentUser?.id ?? null}
				onSaveStateChange={setPageSaveState}
			/>
			{/* Same 54px inset as the editor content column. */}
			<div className="px-0 md:px-[54px]">
				<Backlinks pageId={pageId} />
			</div>
		</div>
	);
}
