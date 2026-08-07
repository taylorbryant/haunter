"use client";

type EditorTimingInput = {
	pageId: string;
	editorCreateStartedAt: number;
	editorCreatedAt: number;
};

type ResourceTiming = {
	name: string;
	initiatorType?: string;
	startMs: number;
	durationMs: number;
	transferBytes: number;
	decodedBytes: number;
};

export type PageLoadStartSource = "direct" | "navigation" | "render";

type PageLoadVisit = {
	pageId: string;
	startedAt: number;
	startSource: PageLoadStartSource;
	marks: Map<string, number>;
	published: boolean;
};

export function createPageLoadLifecycle() {
	let activeVisit: PageLoadVisit | null = null;
	let completedPageId: string | null = null;

	function start(
		pageId: string,
		startedAt: number,
		startSource: Exclude<PageLoadStartSource, "render">,
	) {
		if (activeVisit?.pageId === pageId && !activeVisit.published) {
			if (startedAt < activeVisit.startedAt) {
				activeVisit.startedAt = startedAt;
				activeVisit.startSource = startSource;
			}
			return activeVisit;
		}

		completedPageId = null;
		activeVisit = {
			pageId,
			startedAt,
			startSource,
			marks: new Map(),
			published: false,
		};
		return activeVisit;
	}

	function beginRender(pageId: string, startedAt: number) {
		if (activeVisit?.pageId === pageId && !activeVisit.published) {
			return activeVisit;
		}
		if (activeVisit && activeVisit.startSource !== "render") return null;
		if (completedPageId === pageId) return null;

		activeVisit = {
			pageId,
			startedAt,
			startSource: "render",
			marks: new Map(),
			published: false,
		};
		return activeVisit;
	}

	function mark(stage: string, markedAt: number) {
		activeVisit?.marks.set(stage, markedAt);
	}

	function complete(pageId: string) {
		const visit = activeVisit;
		if (!visit || visit.pageId !== pageId || visit.published) return null;
		visit.published = true;
		completedPageId = pageId;
		activeVisit = null;
		return visit;
	}

	function current() {
		return activeVisit;
	}

	return { start, beginRender, mark, complete, current };
}

const PERF_SESSION_KEY = "haunter:page-load-performance";
const lifecycle = createPageLoadLifecycle();
let enabledCache: boolean | null = null;
let instrumentationInitialized = false;
let longTaskObserverStarted = false;
const moduleMarks = new Map<string, number>();
const longTasks: Array<{ startMs: number; durationMs: number }> = [];

function readSessionFlag() {
	try {
		return window.sessionStorage.getItem(PERF_SESSION_KEY) === "1";
	} catch {
		return false;
	}
}

function writeSessionFlag(enabled: boolean) {
	try {
		if (enabled) window.sessionStorage.setItem(PERF_SESSION_KEY, "1");
		else window.sessionStorage.removeItem(PERF_SESSION_KEY);
	} catch {
		// Instrumentation must never interfere with navigation.
	}
}

export function pageLoadPerformanceEnabled() {
	if (typeof window === "undefined") return false;
	const requested = new URLSearchParams(window.location.search).get("perf");
	if (requested === "1") {
		if (enabledCache !== true) writeSessionFlag(true);
		enabledCache = true;
		return true;
	}
	if (requested === "0") {
		if (enabledCache !== false) writeSessionFlag(false);
		enabledCache = false;
		return false;
	}
	enabledCache ??= readSessionFlag();
	return enabledCache;
}

export function pageIdFromPagePathname(pathname: string) {
	const encodedPageId = pathname.match(/^\/w\/[^/]+\/p\/([^/]+)\/?$/)?.[1];
	if (!encodedPageId) return null;
	try {
		return decodeURIComponent(encodedPageId);
	} catch {
		return encodedPageId;
	}
}

function navigationStartedAt() {
	const navigation = performance.getEntriesByType("navigation")[0];
	return navigation?.startTime ?? 0;
}

export function startPageLoadNavigation(pageId: string) {
	if (!pageLoadPerformanceEnabled()) return;
	lifecycle.start(pageId, performance.now(), "navigation");
}

export function beginPageLoadVisit(pageId: string) {
	if (!pageLoadPerformanceEnabled()) return;
	lifecycle.beginRender(pageId, performance.now());
}

export function markPageLoad(stage: string) {
	if (!pageLoadPerformanceEnabled()) return;
	const now = performance.now();
	if (lifecycle.current()) {
		lifecycle.mark(stage, now);
	} else if (stage.endsWith("module-evaluated")) {
		moduleMarks.set(stage, now);
	}
}

function startPageLoadLongTaskObserver() {
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

function pageLinkFromClick(event: MouseEvent) {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	) {
		return null;
	}
	const target = event.target;
	if (!(target instanceof Element)) return null;
	const anchor = target.closest("a[href]");
	if (!(anchor instanceof HTMLAnchorElement)) return null;
	if (anchor.target && anchor.target !== "_self") return null;
	if (anchor.hasAttribute("download")) return null;

	const url = new URL(anchor.href, window.location.href);
	if (url.origin !== window.location.origin) return null;
	if (url.pathname === window.location.pathname) return null;
	return pageIdFromPagePathname(url.pathname);
}

export function initializePageLoadPerformance() {
	if (!pageLoadPerformanceEnabled() || instrumentationInitialized) return;
	instrumentationInitialized = true;
	startPageLoadLongTaskObserver();

	const directPageId = pageIdFromPagePathname(window.location.pathname);
	if (directPageId) {
		lifecycle.start(directPageId, navigationStartedAt(), "direct");
	}

	document.addEventListener(
		"click",
		(event) => {
			const pageId = pageLinkFromClick(event);
			if (pageId) startPageLoadNavigation(pageId);
		},
		true,
	);
	window.addEventListener("popstate", () => {
		const pageId = pageIdFromPagePathname(window.location.pathname);
		if (pageId) startPageLoadNavigation(pageId);
	});
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

function slowestResources(startedAt: number): ResourceTiming[] {
	return performance
		.getEntriesByType("resource")
		.filter(
			(entry): entry is PerformanceResourceTiming =>
				entry instanceof PerformanceResourceTiming &&
				entry.startTime >= startedAt &&
				["fetch", "script", "link"].includes(entry.initiatorType),
		)
		.sort((left, right) => right.duration - left.duration)
		.slice(0, 8)
		.map((entry) => {
			const url = new URL(entry.name);
			return {
				name: `${url.pathname}${url.searchParams.has("_rsc") ? "?_rsc" : ""}`,
				initiatorType: entry.initiatorType,
				startMs: Math.round(entry.startTime - startedAt),
				durationMs: Math.round(entry.duration),
				transferBytes: entry.transferSize,
				decodedBytes: entry.decodedBodySize,
			};
		});
}

function directNavigationTiming(startSource: PageLoadStartSource) {
	if (startSource !== "direct") return null;
	const navigation = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (!navigation) return null;
	return {
		ttfbMs: Math.round(navigation.responseStart),
		responseEndMs: Math.round(navigation.responseEnd),
		domInteractiveMs: Math.round(navigation.domInteractive),
		domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
		transferBytes: navigation.transferSize,
		decodedBytes: navigation.decodedBodySize,
	};
}

export function publishPageLoadTimings({
	pageId,
	editorCreateStartedAt,
	editorCreatedAt,
}: EditorTimingInput) {
	if (!pageLoadPerformanceEnabled()) return;
	const visit = lifecycle.current();
	if (!visit || visit.pageId !== pageId || visit.published) return;

	markPageLoad("editor-painted");
	const completedVisit = lifecycle.complete(pageId);
	if (!completedVisit) return;
	const summary = {
		pageId,
		startSource: completedVisit.startSource,
		navigation: directNavigationTiming(completedVisit.startSource),
		pageEditorModuleMs: relativeMark(
			completedVisit,
			"page-editor-module-evaluated",
		),
		pageEditorMountedMs: relativeMark(completedVisit, "page-editor-mounted"),
		pageDataReadyMs: relativeMark(completedVisit, "page-data-ready"),
		editorModuleEvaluatedMs: relativeMark(
			completedVisit,
			"editor-module-evaluated",
		),
		editorCreateStartMs: Math.round(
			editorCreateStartedAt - completedVisit.startedAt,
		),
		editorCreateEndMs: Math.round(editorCreatedAt - completedVisit.startedAt),
		editorCreateDurationMs: Math.round(editorCreatedAt - editorCreateStartedAt),
		editorCommittedMs: relativeMark(completedVisit, "editor-committed"),
		editorPaintedMs: relativeMark(completedVisit, "editor-painted"),
		longTasks: longTasks
			.filter((entry) => entry.startMs >= completedVisit.startedAt)
			.map((entry) => ({
				startMs: Math.round(entry.startMs - completedVisit.startedAt),
				durationMs: entry.durationMs,
			})),
		slowestScripts: slowestScripts(completedVisit.startedAt),
		slowestResources: slowestResources(completedVisit.startedAt),
	};

	document.documentElement.dataset.haunterPageLoad = JSON.stringify(summary);
	console.info("[page-load:client]", summary);
}
