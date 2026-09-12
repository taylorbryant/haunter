/** Opt-in local diagnostics. No document text, identifiers, or network telemetry. */
export type EditorMeasurement = { startedAt: number; reported: boolean };
let navigationReported = false;

export function beginEditorMeasurement(): EditorMeasurement | undefined {
	if (
		typeof window === "undefined" ||
		new URLSearchParams(window.location.search).get("editorPerformance") !== "1"
	)
		return;
	return { startedAt: performance.now(), reported: false };
}

export function observeEditorPerformance(
	element: HTMLElement,
	measurement: EditorMeasurement,
	document: { readySource: string | null; readyMs: number | null } | undefined,
) {
	let stopped = false;
	const frames = new Set<number>();
	const afterPaint = (run: () => void) => {
		const next = (callback: () => void) => {
			const id = requestAnimationFrame(() => {
				frames.delete(id);
				if (!stopped) callback();
			});
			frames.add(id);
		};
		next(() => next(run));
	};
	const report = (
		name: string,
		start: number,
		detail: Record<string, unknown> = {},
	) => {
		const end = performance.now();
		// Bound entries even during a long typing benchmark.
		performance.clearMeasures(name);
		performance.measure(name, { start, end, detail });
		console.info(
			"[haunter-editor-performance]",
			JSON.stringify({
				name,
				durationMs: Math.round((end - start) * 10) / 10,
				...detail,
			}),
		);
	};
	const ready = () => {
		if (
			measurement.reported ||
			!element.querySelector('[contenteditable="true"]')
		)
			return;
		afterPaint(() => {
			if (
				measurement.reported ||
				!element.isConnected ||
				!element.getClientRects().length
			)
				return;
			measurement.reported = true;
			observer.disconnect();
			const detail = {
				bodySource: document?.readySource ?? "json",
				bodyReadyMs: document?.readyMs ?? null,
			};
			report("haunter:route-render-to-editable", measurement.startedAt, detail);
			const navigation = performance.getEntriesByType("navigation")[0];
			// Only direct loads of this exact route include navigation, server, and bundle time.
			if (
				!navigationReported &&
				navigation &&
				new URL(navigation.name).pathname === window.location.pathname &&
				new URL(navigation.name).searchParams.get("editorPerformance") === "1"
			) {
				navigationReported = true;
				report("haunter:navigation-to-editable", navigation.startTime, detail);
			}
		});
	};
	const observer = new MutationObserver(ready);
	observer.observe(element, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["contenteditable"],
	});
	ready();
	let inputStarted: number | null = null;
	const beforeInput = () => {
		inputStarted = performance.now();
	};
	const input = () => {
		if (inputStarted === null) return;
		const start = inputStarted;
		inputStarted = null;
		afterPaint(() => report("haunter:input-to-frame", start));
	};
	element.addEventListener("beforeinput", beforeInput, true);
	element.addEventListener("input", input, true);
	return () => {
		stopped = true;
		observer.disconnect();
		for (const frame of frames) cancelAnimationFrame(frame);
		element.removeEventListener("beforeinput", beforeInput, true);
		element.removeEventListener("input", input, true);
	};
}
