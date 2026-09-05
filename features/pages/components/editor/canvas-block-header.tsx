import { Maximize2Icon, XIcon } from "lucide-react";
import type { Ref } from "react";
import type { CanvasSaveState } from "@/features/canvases/components/canvas-surface";

export function CanvasBlockHeader({
	expanded,
	saveState,
	buttonRef,
	onToggle,
}: {
	expanded: boolean;
	saveState: CanvasSaveState;
	buttonRef?: Ref<HTMLButtonElement>;
	onToggle: () => void;
}) {
	return (
		<div className="flex h-9 shrink-0 items-center justify-between border-b bg-[var(--code-block-header-background)] px-2">
			<span
				aria-atomic="true"
				aria-live="polite"
				className="min-w-0 truncate px-1 text-muted-foreground text-xs"
			>
				{saveState === "saving" ? "Saving…" : null}
			</span>
			<button
				ref={buttonRef}
				type="button"
				aria-label={expanded ? "Close canvas" : "Expand canvas"}
				className="keyboard-focus-ring relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onClick={onToggle}
			>
				<span
					aria-hidden="true"
					className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
				/>
				{expanded ? (
					<XIcon className="size-4" />
				) : (
					<Maximize2Icon className="size-4" />
				)}
			</button>
		</div>
	);
}
