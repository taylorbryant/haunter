"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	EmojiPicker,
	EmojiPickerContent,
	EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	setPageIconInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";

/** Persist a page's icon and refresh every surface that renders it. */
function useSetPageIcon(pageId: string) {
	const queryClient = useQueryClient();
	const updateMutation = useMutation(updatePageMutationOptions());

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
				<EmojiPickerSearch placeholder="Search emoji…" />
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

/**
 * Notion-style icon control shown above the page title. Renders the current
 * emoji, or a hover-revealed "Add icon" affordance when the page has none.
 */
export function PageIconButton({
	pageId,
	icon,
}: {
	pageId: string;
	icon: string | null;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{icon ? (
					<button
						type="button"
						aria-label="Change icon"
						className="rounded-md p-1 text-4xl leading-none transition-colors hover:bg-muted"
					>
						{icon}
					</button>
				) : (
					<button
						type="button"
						className="-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-sm opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/header:opacity-100 aria-expanded:opacity-100"
					>
						<SmilePlusIcon className="size-4" />
						Add icon
					</button>
				)}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-0">
				<PageIconPanel
					pageId={pageId}
					hasIcon={icon !== null}
					onDone={() => setOpen(false)}
				/>
			</PopoverContent>
		</Popover>
	);
}
