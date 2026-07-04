"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
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
import { cn } from "@/lib/utils";

/**
 * Notion-style callout colors. Colored variants are low-opacity tints so they
 * read on both light and dark page backgrounds without dark-mode overrides.
 */
const CALLOUT_COLORS = {
	default: {
		label: "Default",
		swatch: "bg-muted-foreground/40",
		container: "border-border bg-muted/60",
	},
	red: {
		label: "Red",
		swatch: "bg-red-500",
		container: "border-red-500/20 bg-red-500/10",
	},
	amber: {
		label: "Amber",
		swatch: "bg-amber-500",
		container: "border-amber-500/25 bg-amber-500/10",
	},
	green: {
		label: "Green",
		swatch: "bg-green-500",
		container: "border-green-500/20 bg-green-500/10",
	},
	blue: {
		label: "Blue",
		swatch: "bg-blue-500",
		container: "border-blue-500/25 bg-blue-500/10",
	},
	purple: {
		label: "Purple",
		swatch: "bg-purple-500",
		container: "border-purple-500/25 bg-purple-500/10",
	},
} as const;

type CalloutColor = keyof typeof CALLOUT_COLORS;

function CalloutView({
	emoji,
	color,
	contentRef,
	onChange,
}: {
	emoji: string;
	color: string;
	contentRef: (node: HTMLElement | null) => void;
	onChange: (props: { emoji?: string; color?: string }) => void;
}) {
	const [open, setOpen] = useState(false);
	const colorKey: CalloutColor =
		color in CALLOUT_COLORS ? (color as CalloutColor) : "default";
	const theme = CALLOUT_COLORS[colorKey];

	return (
		<div
			className={cn(
				"my-1 flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5",
				theme.container,
			)}
		>
			<div contentEditable={false} className="shrink-0">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label="Change callout icon and color"
							className="mt-px flex size-6 items-center justify-center rounded text-lg leading-none transition-colors hover:bg-foreground/10"
						>
							{emoji || "💡"}
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-auto p-0">
						<div className="flex items-center gap-1.5 border-b p-2">
							{Object.entries(CALLOUT_COLORS).map(([key, value]) => (
								<button
									key={key}
									type="button"
									aria-label={value.label}
									onClick={() => onChange({ color: key })}
									className={cn(
										"size-5 rounded-full border transition-transform hover:scale-110",
										value.swatch,
										key === colorKey &&
											"ring-2 ring-ring ring-offset-1 ring-offset-background",
									)}
								/>
							))}
						</div>
						<div className="flex h-[300px] w-[288px] flex-col">
							<EmojiPicker
								className="min-h-0 flex-1"
								onEmojiSelect={(selected) => {
									onChange({ emoji: selected.emoji });
									setOpen(false);
								}}
							>
								<EmojiPickerSearch placeholder="Search emoji…" />
								<EmojiPickerContent />
							</EmojiPicker>
						</div>
					</PopoverContent>
				</Popover>
			</div>
			<div ref={contentRef} className="min-w-0 flex-1 py-0.5" />
		</div>
	);
}

export const calloutBlockSpec = createReactBlockSpec(
	{
		type: "callout",
		propSchema: {
			emoji: { default: "💡" },
			color: { default: "default" },
		},
		content: "inline",
	},
	{
		render: ({ block, editor, contentRef }) => (
			<CalloutView
				emoji={block.props.emoji}
				color={block.props.color}
				contentRef={contentRef}
				onChange={(props) =>
					editor.updateBlock(block, { props: { ...block.props, ...props } })
				}
			/>
		),
	},
);
