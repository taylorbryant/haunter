"use client";

import { SmilePlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

const PageIconPanel = dynamic(
	() =>
		import("./page-icon-panel").then((mod) => ({
			default: mod.PageIconPanel,
		})),
	{
		ssr: false,
		loading: () => <div className="h-[300px] w-[288px]" aria-hidden />,
	},
);

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
			<PopoverTrigger
				render={
					icon ? (
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
							className="-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-sm opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/header:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
						>
							<SmilePlusIcon className="size-4" />
							Add icon
						</button>
					)
				}
			/>
			{open ? (
				<PopoverContent align="start" className="w-auto p-0">
					<PageIconPanel
						pageId={pageId}
						hasIcon={icon !== null}
						onDone={() => setOpen(false)}
					/>
				</PopoverContent>
			) : null}
		</Popover>
	);
}
