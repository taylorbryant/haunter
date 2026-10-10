import { type Editor, react } from "tldraw";

/** Fit public drawings to the reader's viewport instead of the author's camera. */
export function fitSharedCanvas(editor: Editor) {
	const container = editor.getContainer();
	let frame = 0;
	let width = 0;
	let height = 0;

	function scheduleFit() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			if (!container.isConnected) return;
			const bounds = container.getBoundingClientRect();
			if (bounds.width <= 0 || bounds.height <= 0) return;
			width = bounds.width;
			height = bounds.height;
			// Measure before fitting: tldraw throttles its own resize observer.
			editor.updateViewportScreenBounds(container);
			editor.zoomToFit({ immediate: true });
		});
	}

	const observer = new ResizeObserver(() => {
		const bounds = container.getBoundingClientRect();
		if (bounds.width !== width || bounds.height !== height) scheduleFit();
	});
	observer.observe(container);
	// Schedule outside the reactive read so panning and zooming do not refit.
	const stop = react("fit shared canvas page", () => {
		editor.getCurrentPageId();
		scheduleFit();
	});

	return () => {
		stop();
		observer.disconnect();
		cancelAnimationFrame(frame);
	};
}
