"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	createPageMutationOptions,
	invalidatePages,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import {
	focusTitleOnArrival,
	primeTitleKeyboard,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";

export default function WorkspacePage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);
	const router = useRouter();
	const queryClient = useQueryClient();
	const pagesQuery = useQuery(listPagesQueryOptions(workspaceId));
	const createMutation = useMutation(createPageMutationOptions());
	const canEdit = useCanEditWorkspace();

	const firstRootPage = pagesQuery.data?.items.find(
		(page) => page.parentPageId === null,
	);

	useEffect(() => {
		if (firstRootPage) {
			router.replace(`/w/${workspaceId}/p/${firstRootPage.id}`);
		}
	}, [firstRootPage, router, workspaceId]);

	if (pagesQuery.isPending || firstRootPage) {
		return null;
	}

	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 py-24">
			<p className="text-muted-foreground text-sm">
				This workspace has no pages yet.
			</p>
			{canEdit ? (
				<Button
					disabled={createMutation.isPending}
					onClick={() => {
						primeTitleKeyboard();
						createMutation.mutate(
							{ body: { workspaceId, title: "" } },
							{
								onSuccess: async (page) => {
									await invalidatePages(queryClient);
									focusTitleOnArrival(page.id);
									router.push(`/w/${workspaceId}/p/${page.id}`);
								},
								onError: releaseTitleKeyboardPrime,
							},
						);
					}}
				>
					Create your first page
				</Button>
			) : null}
		</div>
	);
}
