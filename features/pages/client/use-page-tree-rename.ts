"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { PAGE_TITLE_MAX_LENGTH, PAGE_TITLE_TOO_LONG_MESSAGE } from "../schemas";
import type { PageTreeNode } from "./page-tree-controller";
import {
	invalidatePages,
	optimisticallySetPageTitle,
	restorePageTitleInCache,
	setPageTitleInCache,
	updatePageMutationOptions,
} from "./queries";
import { flushPendingPageSave } from "./save-state";

export function usePageTreeRename({
	workspaceId,
	nodesById,
}: {
	workspaceId: string;
	nodesById: ReadonlyMap<string, PageTreeNode>;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [pageId, setPageId] = useState<string | null>(null);
	const [value, setValue] = useState("");
	const [error, setError] = useState<{
		pageId: string;
		message: string;
	} | null>(null);
	const pendingPageIds = useRef(new Set<string>());

	async function commit(id: string) {
		if (mutation.isPending || pendingPageIds.current.has(id)) return;
		const node = nodesById.get(id);
		if (!node) return;
		const title = value.trim();
		if (!title) {
			setPageId((current) => (current === id ? null : current));
			setError(null);
			return;
		}
		if (title.length > PAGE_TITLE_MAX_LENGTH) {
			setError({ pageId: id, message: PAGE_TITLE_TOO_LONG_MESSAGE });
			return;
		}
		// Enter can trigger blur before React renders the mutation's pending state.
		// Claim the page before waiting for saves or updating the cache.
		pendingPageIds.current.add(id);
		setError(null);
		let snapshot: Awaited<
			ReturnType<typeof optimisticallySetPageTitle>
		> | null = null;
		try {
			if (!(await flushPendingPageSave(id))) {
				setError({
					pageId: id,
					message: "Save the current page before renaming it.",
				});
				return;
			}
			snapshot = await optimisticallySetPageTitle(
				queryClient,
				workspaceId,
				id,
				title,
				{
					previousTitle: node.title,
					previousUpdatedAt: node.updatedAt,
				},
			);
			setPageId((current) => (current === id ? null : current));
			const page = await mutation.mutateAsync({
				path: { id },
				body: { title },
			});
			setError((current) => (current?.pageId === id ? null : current));
			setPageTitleInCache(queryClient, page.id, page.title, page.updatedAt);
		} catch (error) {
			if (snapshot) {
				restorePageTitleInCache(
					queryClient,
					id,
					title,
					snapshot.previousTitle,
					snapshot.previousUpdatedAt,
				);
			}
			setPageId(id);
			setError({
				pageId: id,
				message: userErrorMessage(
					error,
					snapshot
						? "The page could not be renamed."
						: "The current page could not be saved before renaming.",
				),
			});
		} finally {
			pendingPageIds.current.delete(id);
			if (snapshot) void invalidatePages(queryClient);
		}
	}

	return {
		pageId,
		value,
		error,
		isPending: mutation.isPending,
		commit,
		start(node: PageTreeNode) {
			if (mutation.isPending) return;
			setError(null);
			setPageId(node.id);
			setValue(node.title);
		},
		change(next: string) {
			setValue(next);
			setError(null);
		},
		cancel() {
			setPageId(null);
			setError(null);
		},
	};
}
