"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { Maximize2Icon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { flushPendingCanvasSave } from "@/features/canvases/client/save-state";

// tldraw is a ~MB chunk: load it only when a canvas block actually renders.
const CanvasSurface = dynamic(
	() => import("@/features/canvases/components/canvas-surface"),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading canvas…
			</div>
		),
	},
);

function CanvasBlockView({ canvasId }: { canvasId: string }) {
	const [expanded, setExpanded] = useState(false);
	const [changingView, setChangingView] = useState(false);
	const changingViewRef = useRef(false);

	async function changeExpanded(nextExpanded: boolean) {
		if (changingViewRef.current || nextExpanded === expanded) return;
		changingViewRef.current = true;
		setChangingView(true);
		try {
			const saved = await flushPendingCanvasSave(canvasId);
			if (saved) setExpanded(nextExpanded);
		} finally {
			changingViewRef.current = false;
			setChangingView(false);
		}
	}

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex h-9 shrink-0 items-center justify-end border-b bg-background/95 px-2">
				<button
					type="button"
					aria-label="Expand canvas"
					className="keyboard-focus-ring flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					disabled={changingView}
					onClick={() => void changeExpanded(true)}
				>
					<Maximize2Icon className="size-4" />
				</button>
			</div>
			<div className="min-h-0 flex-1">
				{expanded ? (
					<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
						Editing in expanded view…
					</div>
				) : (
					<CanvasSurface canvasId={canvasId} />
				)}
			</div>
			{expanded ? (
				<Dialog
					open
					onOpenChange={(open) => !open && void changeExpanded(false)}
				>
					<DialogContent
						showCloseButton={false}
						className="h-[85vh] overflow-visible p-0 sm:max-w-[90vw]"
					>
						<DialogTitle className="sr-only">Canvas</DialogTitle>
						{/* Only one tldraw instance per canvas at a time: the inline
						    surface is unmounted while the dialog is open. */}
						<div className="isolate h-full w-full overflow-hidden rounded-lg">
							<CanvasSurface canvasId={canvasId} />
						</div>
						{/* Close sits just outside the card's top-right corner — over
						    the backdrop and clear of tldraw's own top-right UI — as a
						    semi-transparent circle. */}
						<DialogClose
							disabled={changingView}
							render={
								<button
									type="button"
									aria-label="Close canvas"
									className="-top-3 -right-3 absolute z-10 flex size-9 items-center justify-center rounded-full bg-background/70 text-muted-foreground ring-1 ring-border/60 backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
								/>
							}
						>
							<XIcon className="size-5" />
						</DialogClose>
					</DialogContent>
				</Dialog>
			) : null}
		</div>
	);
}

export const canvasBlockSpec = createReactBlockSpec(
	{
		type: "canvas",
		propSchema: {
			canvasId: { default: "" },
		},
		content: "none",
	},
	{
		// Don't let ProseMirror node-select the block (the blue outline) when the
		// canvas is tapped — all interaction belongs to tldraw.
		meta: { selectable: false },
		render: ({ block }) => {
			const canvasId = block.props.canvasId;

			return (
				// `isolate` traps tldraw's internal z-indexes (its UI layer is
				// z-300) inside this block so editor menus can float above it.
				// ProseMirror treats non-editable node views as draggable — kill
				// dragstart here so drawing strokes never drag the whole block.
				// The pointer/mouse/touch handlers stop the events from bubbling to
				// ProseMirror, so tapping the canvas doesn't focus the editor or
				// place a caret (which on iOS pops the keyboard). tldraw, a
				// descendant, still receives them.
				// biome-ignore lint/a11y/noStaticElementInteractions: handlers only shield ProseMirror; all interaction lives in the embedded tldraw canvas
				<div
					className="isolate my-2 h-[480px] w-full overflow-hidden rounded-lg border"
					contentEditable={false}
					draggable={false}
					onDragStart={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
					onPointerDown={(event) => event.stopPropagation()}
					onMouseDown={(event) => event.stopPropagation()}
					onTouchStart={(event) => event.stopPropagation()}
				>
					{canvasId === "" ? (
						<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
							Creating canvas…
						</div>
					) : (
						<CanvasBlockView canvasId={canvasId} />
					)}
				</div>
			);
		},
	},
);
