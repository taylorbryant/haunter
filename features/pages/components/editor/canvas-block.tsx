"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { Maximize2Icon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CanvasSaveState } from "@/features/canvases/components/canvas-surface";
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
	onSaveStateChange,
	layoutKey,
}: {
	canvasId: string;
	onSaveStateChange: (state: CanvasSaveState) => void;
	layoutKey: string;
}) {
	return (
		<CanvasSurface
			canvasId={canvasId}
			onSaveStateChange={onSaveStateChange}
			layoutKey={layoutKey}
		/>
	);
});

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

function visibleFocusableElements(container: HTMLElement): HTMLElement[] {
	return [
		...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	].filter(
		(element) =>
			element.tabIndex >= 0 &&
			element.getClientRects().length > 0 &&
			element.getAttribute("aria-hidden") !== "true",
	);
}

function focusVisibleCloseButton(container: HTMLElement) {
	[...container.querySelectorAll<HTMLElement>('[aria-label="Close canvas"]')]
		.find((element) => element.getClientRects().length > 0)
		?.focus();
}

function CanvasBlockView({ canvasId }: { canvasId: string }) {
	const [expanded, setExpanded] = useState(false);
	const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
	const overlayRef = useRef<HTMLDivElement>(null);
	const headerButtonRef = useRef<HTMLButtonElement>(null);
	const handleSaveStateChange = useCallback((state: CanvasSaveState) => {
		setSaveState(state);
	}, []);
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
		const modalOverlay: HTMLElement = overlay;
		const bodyOverflow = document.body.style.overflow;
		const appMain = modalOverlay.closest("main");
		const mainZIndex = appMain?.style.zIndex ?? "";

		// The app's <main> is an isolation boundary. Raise that boundary above
		// the sidebar while its descendant is acting as the modal overlay.
		if (appMain instanceof HTMLElement) appMain.style.zIndex = "50";
		document.body.style.overflow = "hidden";

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				setExpanded(false);
				return;
			}
			if (event.key !== "Tab") return;

			const focusable = visibleFocusableElements(modalOverlay);
			if (focusable.length === 0) {
				event.preventDefault();
				focusVisibleCloseButton(modalOverlay);
				return;
			}

			const first = focusable[0];
			const last = focusable.at(-1);
			const active = document.activeElement;
			if (
				event.shiftKey
					? active === first || !modalOverlay.contains(active)
					: active === last || !modalOverlay.contains(active)
			) {
				event.preventDefault();
				(event.shiftKey ? last : first)?.focus();
			}
		}

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = bodyOverflow;
			if (appMain instanceof HTMLElement) appMain.style.zIndex = mainZIndex;
			headerButtonRef.current?.focus();
		};
	}, [expanded]);

	return (
		<div
			ref={overlayRef}
			{...dialogProps}
			className={cn(
				"isolate flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground",
				expanded &&
					"fixed inset-0 z-50 items-center justify-center overflow-hidden rounded-none bg-background md:bg-black/80",
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
						"h-dvh w-screen overflow-hidden rounded-none border-0 bg-background shadow-none md:h-[85dvh] md:w-[90vw] md:rounded-lg md:border md:shadow-lg",
				)}
			>
				<div className="flex h-9 shrink-0 items-center justify-between border-b bg-[var(--code-block-header-background)] px-2">
					<span
						aria-atomic="true"
						aria-live="polite"
						className="min-w-0 truncate px-1 text-muted-foreground text-xs"
					>
						{saveState === "saving" ? "Saving…" : null}
					</span>
					<button
						ref={headerButtonRef}
						type="button"
						aria-label={expanded ? "Close canvas" : "Expand canvas"}
						className="keyboard-focus-ring relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onClick={() => setExpanded((current) => !current)}
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
					<div
						className={cn(
							"min-h-0 flex-1",
							expanded && "overflow-hidden",
						)}
					>
					<StableCanvasSurface
						canvasId={canvasId}
						onSaveStateChange={handleSaveStateChange}
						layoutKey={expanded ? "fullscreen" : "inline"}
					/>
				</div>
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
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
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
