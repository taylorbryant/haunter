"use client";

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

export function WorkspaceIconPicker({
	id,
	icon,
	onIconChange,
}: {
	id: string;
	icon: string | null;
	onIconChange: (icon: string | null) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						id={id}
						type="button"
						variant="outline"
						size="icon"
						className="relative text-base leading-none after:absolute after:-inset-1.5 after:content-[''] sm:after:hidden"
						aria-label="Choose emoji"
					/>
				}
			>
				{icon ?? <SmilePlusIcon className="size-4 text-muted-foreground" />}
			</PopoverTrigger>
			{open ? (
				<PopoverContent className="w-auto p-0" align="start">
					<div className="flex h-[300px] w-[288px] flex-col">
						<EmojiPicker
							className="min-h-0 flex-1"
							onEmojiSelect={({ emoji }) => {
								onIconChange(emoji);
								setOpen(false);
							}}
						>
							<EmojiPickerSearch placeholder="Search emoji..." />
							<EmojiPickerContent />
						</EmojiPicker>
						{icon ? (
							<div className="border-t p-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="w-full justify-start text-muted-foreground"
									onClick={() => {
										onIconChange(null);
										setOpen(false);
									}}
								>
									Remove emoji
								</Button>
							</div>
						) : null}
					</div>
				</PopoverContent>
			) : null}
		</Popover>
	);
}
