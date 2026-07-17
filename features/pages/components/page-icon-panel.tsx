"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
	EmojiPicker,
	EmojiPickerContent,
	EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
	invalidatePage,
	invalidatePages,
	setPageIconInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";

/** Persist a page's icon and refresh every surface that renders it. */
function useSetPageIcon(pageId: string) {
	const queryClient = useQueryClient();
	const updateMutation = useMutation({
		...updatePageMutationOptions(),
		onError: () => {
			void Promise.all([
				invalidatePage(queryClient, pageId),
				invalidatePages(queryClient),
			]);
		},
	});

	return (icon: string | null) => {
		// Write the caches synchronously: the picker closes (unmounting this
		// hook) the moment an emoji is chosen, which would drop a mutation
		// callback, so the UI can't depend on onSuccess to refresh.
		setPageIconInCache(queryClient, pageId, icon);
		updateMutation.mutate({ path: { id: pageId }, body: { icon } });
	};
}

/**
 * The picker body: an emoji grid plus a "Remove icon" action. Shared by the
 * editor header popover and the sidebar row-menu dialog.
 */
export function PageIconPanel({
	pageId,
	hasIcon,
	onDone,
}: {
	pageId: string;
	hasIcon: boolean;
	onDone: () => void;
}) {
	const setIcon = useSetPageIcon(pageId);

	return (
		<div className="flex h-[300px] w-[288px] flex-col">
			<EmojiPicker
				className="min-h-0 flex-1"
				onEmojiSelect={({ emoji }) => {
					setIcon(emoji);
					onDone();
				}}
			>
				<EmojiPickerSearch placeholder="Search emoji..." />
				<EmojiPickerContent />
			</EmojiPicker>
			{hasIcon ? (
				<div className="border-t p-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-full justify-start text-muted-foreground"
						onClick={() => {
							setIcon(null);
							onDone();
						}}
					>
						Remove icon
					</Button>
				</div>
			) : null}
		</div>
	);
}
