"use client";

import { EmojiPicker as EmojiPickerPrimitive } from "frimousse";
import { LoaderIcon, SearchIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

function EmojiPicker({
	className,
	...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Root>) {
	return (
		<EmojiPickerPrimitive.Root
			data-slot="emoji-picker"
			className={cn(
				"isolate flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function EmojiPickerSearch({
	className,
	...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
	return (
		<div
			data-slot="emoji-picker-search-wrapper"
			className="flex h-9 items-center gap-2 border-b px-3"
		>
			<SearchIcon className="size-4 shrink-0 opacity-50" />
			<EmojiPickerPrimitive.Search
				data-slot="emoji-picker-search"
				className={cn(
					"h-9 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function EmojiPickerContent({
	className,
	...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport>) {
	return (
		<EmojiPickerPrimitive.Viewport
			data-slot="emoji-picker-viewport"
			className={cn("relative flex-1 outline-hidden", className)}
			{...props}
		>
			<EmojiPickerPrimitive.Loading className="absolute inset-0 flex items-center justify-center text-muted-foreground">
				<LoaderIcon className="size-4 animate-spin" />
			</EmojiPickerPrimitive.Loading>
			<EmojiPickerPrimitive.Empty className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
				No emoji found.
			</EmojiPickerPrimitive.Empty>
			<EmojiPickerPrimitive.List
				className="select-none pb-1"
				components={{
					CategoryHeader: ({ category, ...props }) => (
						<div
							className="bg-popover px-3 pt-3.5 pb-1.5 font-medium text-muted-foreground text-xs"
							{...props}
						>
							{category.label}
						</div>
					),
					Row: ({ children, ...props }) => (
						<div className="scroll-my-1 px-1" {...props}>
							{children}
						</div>
					),
					Emoji: ({ emoji, ...props }) => (
						<button
							type="button"
							className="flex size-7 items-center justify-center rounded-md text-base data-[active]:bg-accent"
							{...props}
						>
							{emoji.emoji}
						</button>
					),
				}}
			/>
		</EmojiPickerPrimitive.Viewport>
	);
}

export { EmojiPicker, EmojiPickerContent, EmojiPickerSearch };
