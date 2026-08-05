"use client";

function markName(scope: string, stage: string) {
	return `haunter:${scope}:${stage}`;
}

/** Lightweight User Timing instrumentation. Entries are visible in browser
 * performance traces without adding network requests or production logging. */
export function markLoadStage(scope: string, stage: string) {
	if (typeof performance === "undefined") return;
	const name = markName(scope, stage);
	performance.clearMarks(name);
	performance.mark(name);
}

export function measureLoadStage(
	scope: string,
	name: string,
	startStage: string,
	endStage: string,
) {
	if (typeof performance === "undefined") return;
	try {
		performance.clearMeasures(markName(scope, name));
		const measurement = performance.measure(
			markName(scope, name),
			markName(scope, startStage),
			markName(scope, endStage),
		);
		if (process.env.NODE_ENV === "development") {
			console.debug(
				`[Haunter performance] ${measurement.name}: ${measurement.duration.toFixed(1)}ms`,
			);
		}
	} catch {
		// A server-rendered route may not have a client-side navigation-intent
		// mark. Missing optional marks must never affect page loading.
	}
}
