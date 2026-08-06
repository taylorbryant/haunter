"use client";

type EditorTimingInput = {
	pageId: string;
	editorCreateStartedAt: number;
	editorCreatedAt: number;
};

type ResourceTiming = {
	name: string;
	startMs: number;
	durationMs: number;
	transferBytes: number;
	decodedBytes: number;
};

type PageLoadVisit = {
	pageId: string;
	startedAt: number;
	marks: Map<string, number>;
	published: boolean;
};

let activeVisit: PageLoadVisit | null = null;
let longTaskObserverStarted = false;
const moduleMarks = new Map<string, number>();
const longTasks: Array<{ startMs: number; durationMs: number }> = [];

export function pageLoadPerformanceEnabled() {
	return (
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("perf") === "1"
	);
}

export function beginPageLoadVisit(pageId: string) {
	if (!pageLoadPerformanceEnabled()) return;
	if (activeVisit?.pageId === pageId && !activeVisit.published) return;
	longTasks.length = 0;
	activeVisit = {
		pageId,
		startedAt: performance.now(),
		marks: new Map(),
		published: false,
	};
}

export function markPageLoad(stage: string) {
	if (!pageLoadPerformanceEnabled()) return;
	const now = performance.now();
	if (activeVisit) {
		activeVisit.marks.set(stage, now);
	} else if (stage.endsWith("module-evaluated")) {
		moduleMarks.set(stage, now);
	}
}

export function startPageLoadLongTaskObserver() {
	if (
		!pageLoadPerformanceEnabled() ||
		longTaskObserverStarted ||
		typeof PerformanceObserver === "undefined"
	) {
		return;
	}
	if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) return;

	longTaskObserverStarted = true;
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			longTasks.push({
				startMs: Math.round(entry.startTime),
				durationMs: Math.round(entry.duration),
			});
		}
		if (longTasks.length > 200) {
			longTasks.splice(0, longTasks.length - 200);
		}
	});
	observer.observe({ type: "longtask", buffered: true });
}

function relativeMark(visit: PageLoadVisit, stage: string) {
	const mark = visit.marks.get(stage) ?? moduleMarks.get(stage);
	return mark === undefined || mark < visit.startedAt
		? null
		: Math.round(mark - visit.startedAt);
}

function slowestScripts(startedAt: number): ResourceTiming[] {
	return performance
		.getEntriesByType("resource")
		.filter(
			(entry): entry is PerformanceResourceTiming =>
				entry instanceof PerformanceResourceTiming &&
				entry.startTime >= startedAt &&
				(entry.initiatorType === "script" ||
					entry.name.includes("/_next/static/")),
		)
		.sort((left, right) => right.duration - left.duration)
		.slice(0, 8)
		.map((entry) => ({
			name: new URL(entry.name).pathname.split("/").at(-1) ?? entry.name,
			startMs: Math.round(entry.startTime - startedAt),
			durationMs: Math.round(entry.duration),
			transferBytes: entry.transferSize,
			decodedBytes: entry.decodedBodySize,
		}));
}

export function publishPageLoadTimings({
	pageId,
	editorCreateStartedAt,
	editorCreatedAt,
}: EditorTimingInput) {
	if (!pageLoadPerformanceEnabled()) return;
	const visit = activeVisit;
	if (!visit || visit.pageId !== pageId || visit.published) return;

	markPageLoad("editor-painted");
	visit.published = true;
	const summary = {
		pageId,
		pageEditorModuleMs: relativeMark(visit, "page-editor-module-evaluated"),
		pageEditorMountedMs: relativeMark(visit, "page-editor-mounted"),
		pageDataReadyMs: relativeMark(visit, "page-data-ready"),
		editorModuleEvaluatedMs: relativeMark(visit, "editor-module-evaluated"),
		editorCreateStartMs: Math.round(editorCreateStartedAt - visit.startedAt),
		editorCreateEndMs: Math.round(editorCreatedAt - visit.startedAt),
		editorCreateDurationMs: Math.round(editorCreatedAt - editorCreateStartedAt),
		editorCommittedMs: relativeMark(visit, "editor-committed"),
		editorPaintedMs: relativeMark(visit, "editor-painted"),
		longTasks: longTasks
			.filter((entry) => entry.startMs >= visit.startedAt)
			.map((entry) => ({
				startMs: Math.round(entry.startMs - visit.startedAt),
				durationMs: entry.durationMs,
			})),
		slowestScripts: slowestScripts(visit.startedAt),
	};

	document.documentElement.dataset.haunterPageLoad = JSON.stringify(summary);
	console.info("[page-load:client]", summary);
	if (activeVisit === visit) activeVisit = null;
}
