"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { Maximize2Icon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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

// Fullscreen state belongs to the surrounding chrome. Keep it from rerunning
// tldraw's onMount lifecycle while the container changes size.
const StableCanvasSurface = memo(function StableCanvasSurface({
	canvasId,
}: {
	canvasId: string;
}) {
	return <CanvasSurface canvasId={canvasId} />;
});

function CanvasBlockView({ canvasId }: { canvasId: string }) {
	const [expanded, setExpanded] = useState(false);
	const overlayRef = useRef<HTMLDivElement>(null);
	const expandButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogProps = expanded
		? ({
				role: "dialog",
				"aria-label": "Canvas",
				"aria-modal": true,
			} as const)
		: {};

	// Keep the same tldraw editor mounted while fullscreen. Recreating it resets
	// camera/undo state and can rebuild text measurements before fonts settle.
	useEffect(() => {
		if (!expanded) return;

		const overlay = overlayRef.current;
		if (!overlay) return;
		const bodyOverflow = document.body.style.overflow;
		const appMain = overlay.closest("main");
		const mainZIndex = appMain?.style.zIndex ?? "";
		const inertElements: Array<{ element: HTMLElement; inert: boolean }> = [];

		// The app's <main> is an isolation boundary. Raise that boundary above
		// the sidebar while its descendant is acting as the modal overlay.
		if (appMain instanceof HTMLElement) appMain.style.zIndex = "50";
		document.body.style.overflow = "hidden";

		// Portaling would remount tldraw, so reproduce modal inertness in place
		// by disabling siblings along the canvas-to-body ancestor path.
		let current: HTMLElement = overlay;
		while (current.parentElement && current.parentElement !== document.body) {
			const parent = current.parentElement;
			for (const sibling of parent.children) {
				if (sibling === current || !(sibling instanceof HTMLElement)) continue;
				inertElements.push({ element: sibling, inert: sibling.inert });
				sibling.inert = true;
			}
			current = parent;
		}
		for (const sibling of document.body.children) {
			if (sibling === current || !(sibling instanceof HTMLElement)) continue;
			inertElements.push({ element: sibling, inert: sibling.inert });
			sibling.inert = true;
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setExpanded(false);
		}

		document.addEventListener("keydown", handleKeyDown);
		closeButtonRef.current?.focus();

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = bodyOverflow;
			if (appMain instanceof HTMLElement) appMain.style.zIndex = mainZIndex;
			for (const { element, inert } of inertElements) element.inert = inert;
			expandButtonRef.current?.focus();
		};
	}, [expanded]);

	return (
		<div
			ref={overlayRef}
			{...dialogProps}
			className={cn(
				"isolate flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground",
				expanded &&
					"fixed inset-0 z-50 items-center justify-center overflow-visible rounded-none bg-black/80",
			)}
			onPointerDown={(event) => {
				if (expanded && event.target === event.currentTarget) {
					setExpanded(false);
				}
			}}
		>
			<div
				className={cn(
					"relative flex h-full w-full flex-col",
					expanded &&
						"h-[85dvh] w-[90vw] overflow-visible rounded-lg border bg-background shadow-lg",
				)}
			>
				<div
					className={cn(
						"flex h-9 shrink-0 items-center justify-end border-b bg-background/95 px-2",
						expanded && "hidden",
					)}
				>
					<button
						ref={expandButtonRef}
						type="button"
						aria-label="Expand canvas"
						className="keyboard-focus-ring flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onClick={() => setExpanded(true)}
					>
						<Maximize2Icon className="size-4" />
					</button>
				</div>
				<div
					className={cn(
						"min-h-0 flex-1",
						expanded && "overflow-hidden rounded-lg",
					)}
				>
					<StableCanvasSurface canvasId={canvasId} />
				</div>
				<button
					ref={closeButtonRef}
					type="button"
					aria-label="Close canvas"
					className={cn(
						"-top-3 -right-3 absolute z-10 flex size-9 items-center justify-center rounded-full bg-background/70 text-muted-foreground ring-1 ring-border/60 backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground",
						!expanded && "hidden",
					)}
					onClick={() => setExpanded(false)}
				>
					<XIcon className="size-5" />
				</button>
			</div>
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
				// CanvasBlockView owns the isolation boundary so it can temporarily
				// become a viewport overlay without remounting tldraw.
				// ProseMirror treats non-editable node views as draggable — kill
				// dragstart here so drawing strokes never drag the whole block.
				// The pointer/mouse/touch handlers stop the events from bubbling to
				// ProseMirror, so tapping the canvas doesn't focus the editor or
				// place a caret (which on iOS pops the keyboard). tldraw, a
				// descendant, still receives them.
				// biome-ignore lint/a11y/noStaticElementInteractions: handlers only shield ProseMirror; all interaction lives in the embedded tldraw canvas
				<div
					className="my-2 h-[480px] w-full overflow-visible rounded-lg border"
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
