"use client";

import {
	type ComponentProps,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { type Editor, Tldraw } from "tldraw";
import {
	preloadTldrawFonts,
	requiredTldrawFontFaces,
	tldrawFontFaceKey,
} from "@/features/canvases/client/tldraw-fonts";

const FONT_PRELOAD_TIMEOUT_MS = 4_000;

type Props = ComponentProps<typeof Tldraw> & {
	documentSnapshot?: {
		store?: Record<string, unknown>;
	};
	/**
	 * Changes whenever the surrounding shell changes size without remounting
	 * tldraw, such as entering or leaving fullscreen.
	 */
	layoutKey?: string;
};

export function TldrawWithFonts({
	documentSnapshot,
	layoutKey,
	onMount,
	...props
}: Props) {
	// The gate is only for the editor's first measurement pass. Later snapshot
	// updates come from this mounted editor; reacting to them here would
	// temporarily unmount tldraw in the middle of an autosave.
	const [faces] = useState(() => requiredTldrawFontFaces(documentSnapshot));
	const fontKey = faces.map(tldrawFontFaceKey).join("|");
	const [loadedFontKey, setLoadedFontKey] = useState<string | null>(
		faces.length === 0 ? fontKey : null,
	);
	const editorRef = useRef<Editor | null>(null);
	const onMountRef = useRef(onMount);
	onMountRef.current = onMount;
	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor;
		const container = editor.getContainer();
		const ownerDocument = container.ownerDocument;
		const handleDocumentPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (container.contains(target)) editor.focus();
			else editor.blur();
		};
		ownerDocument.addEventListener(
			"pointerdown",
			handleDocumentPointerDown,
			true,
		);
		const teardown = onMountRef.current?.(editor);
		return () => {
			ownerDocument.removeEventListener(
				"pointerdown",
				handleDocumentPointerDown,
				true,
			);
			if (editorRef.current === editor) editorRef.current = null;
			teardown?.();
		};
	}, []);

	// tldraw throttles its own ResizeObserver updates. Fullscreen changes the
	// viewport and overlay canvas in one frame, so waiting for that throttle can
	// leave stale pen/selection pixels on screen even though the store already
	// removed them. Measure immediately, then once more after layout has painted.
	// biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey is an intentional invalidation signal from the surrounding shell.
	useLayoutEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		const syncViewport = () => {
			const container = editor.getContainer();
			if (container.isConnected) {
				editor.updateViewportScreenBounds(container);
			}
		};
		syncViewport();
		const frame = requestAnimationFrame(syncViewport);
		return () => cancelAnimationFrame(frame);
	}, [layoutKey]);

	useEffect(() => {
		if (faces.length === 0) {
			setLoadedFontKey(fontKey);
			return;
		}
		let cancelled = false;
		const finishLoading = () => {
			if (!cancelled) setLoadedFontKey(fontKey);
		};
		const timeout = setTimeout(finishLoading, FONT_PRELOAD_TIMEOUT_MS);
		void preloadTldrawFonts(document, faces).then(() => {
			clearTimeout(timeout);
			finishLoading();
		});
		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [faces, fontKey]);

	if (loadedFontKey !== fontKey) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading canvas…
			</div>
		);
	}

	return <Tldraw autoFocus={false} {...props} onMount={handleMount} />;
}
