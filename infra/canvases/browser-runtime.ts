import { mkdtemp, rm } from "node:fs/promises";
import { freemem, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserServer, type Page } from "playwright";
import { isAppError } from "@beignet/core/errors";
import { canvasBrowserAssets, canvasBrowserOrigin } from "./browser-assets";
import {
	createCanvasPreviewContext,
	type PreviewFiles,
} from "./preview-context";
export { canvasBrowserOrigin } from "./browser-assets";

export type CanvasBrowserJob = {
	signal: AbortSignal;
	page(): Promise<Page>;
};
export type CanvasBrowserMetric = {
	kind: "preview" | "structure";
	outcome: "ok" | "invalid" | "error" | "timeout" | "rejected" | "stopped";
	queueMs: number;
	prepareMs: number;
	launchMs: number;
	renderMs: number;
	cleanupMs: number;
	totalMs: number;
	workerRssPeakBytes: number;
	machineFreeMinBytes: number;
	forcedKill: boolean;
	cleanupIncomplete: boolean;
};
class BrowserDeadlineError extends Error {}
class BrowserStoppedError extends Error {}

/** Only OS/runtime essentials reach Chromium; never copy the worker's secrets. */
export function canvasBrowserEnvironment(directory: string) {
	return {
		PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
		HOME: directory,
		TMPDIR: directory,
		LANG: "en_US.UTF-8",
		TZ: "UTC",
	};
}

async function settlesWithin(promise: Promise<unknown>, ms: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => false,
			),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), Math.max(1, ms));
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** One queue shared by preview decoding, Chromium rendering, and native layout. */
export function createCanvasBrowserRunner(
	options: {
		maxQueued?: number;
		timeoutMs?: number;
		cleanupMs?: number;
		onMetric?: (metric: CanvasBrowserMetric) => void;
		// Injectable browser boundaries keep deadline/cleanup tests deterministic.
		launch?: typeof chromium.launchServer;
		connect?: typeof chromium.connect;
		assets?: () => Promise<PreviewFiles>;
	} = {},
) {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const cleanupMs = options.cleanupMs ?? 4_000;
	const queue: { start(): void; cancel(): void }[] = [];
	let stopped = false;
	let active: { abort(): void; done: Promise<void> } | undefined;
	let state: "starting" | "ready" | "degraded" | "stopped" = "starting";
	let completed = 0,
		failed = 0,
		rejected = 0;
	let lastSuccessAt: string | null = null;
	let lastFailure: CanvasBrowserMetric["outcome"] | null = null;

	function report(metric: CanvasBrowserMetric) {
		if (metric.outcome === "ok") {
			completed++;
			lastSuccessAt = new Date().toISOString();
			state = stopped ? "stopped" : "ready";
		} else if (metric.outcome === "error" || metric.outcome === "timeout") {
			failed++;
			lastFailure = metric.outcome;
			state = stopped ? "stopped" : "degraded";
		} else if (metric.outcome === "rejected") rejected++;
		try {
			options.onMetric?.(metric);
		} catch {
			/* Telemetry cannot affect jobs. */
		}
	}
	function advance() {
		active = undefined;
		if (!stopped) queue.shift()?.start();
	}

	return {
		get available() {
			return !stopped && (!active || queue.length < (options.maxQueued ?? 2));
		},
		health() {
			return {
				ready: state === "ready",
				state,
				active: !!active,
				queued: queue.length,
				completed,
				failed,
				rejected,
				lastSuccessAt,
				lastFailure,
			};
		},
		run<T>(
			kind: CanvasBrowserMetric["kind"],
			execute: (job: CanvasBrowserJob) => Promise<T>,
		): Promise<T> {
			const submitted = performance.now();
			const metric: CanvasBrowserMetric = {
				kind,
				outcome: "ok",
				queueMs: 0,
				prepareMs: 0,
				launchMs: 0,
				renderMs: 0,
				cleanupMs: 0,
				totalMs: 0,
				forcedKill: false,
				cleanupIncomplete: false,
				workerRssPeakBytes: process.memoryUsage().rss,
				machineFreeMinBytes: freemem(),
			};
			if (stopped || (active && queue.length >= (options.maxQueued ?? 2))) {
				metric.outcome = stopped ? "stopped" : "rejected";
				report(metric);
				return Promise.reject(
					new Error("Canvas browser queue is unavailable."),
				);
			}
			return new Promise<T>((resolve, reject) => {
				const controller = new AbortController();
				let begun = false;
				const entry = {
					cancel() {
						clearTimeout(deadline);
						metric.outcome = "stopped";
						metric.totalMs = metric.queueMs = Math.round(
							performance.now() - submitted,
						);
						report(metric);
						reject(new BrowserStoppedError("Canvas browser stopped"));
					},
					start() {
						if (performance.now() - submitted >= timeoutMs) {
							clearTimeout(deadline);
							metric.outcome = "rejected";
							metric.totalMs = metric.queueMs = Math.round(
								performance.now() - submitted,
							);
							report(metric);
							reject(
								new BrowserDeadlineError("Canvas browser queue timed out"),
							);
							advance();
							return;
						}
						begun = true;
						let finish!: () => void;
						active = {
							abort: () =>
								controller.abort(
									new BrowserStoppedError("Canvas browser stopped"),
								),
							done: new Promise<void>((r) => {
								finish = r;
							}),
						};
						void perform().catch(reject).finally(finish);
					},
				};
				const deadline = setTimeout(() => {
					if (begun)
						controller.abort(
							new BrowserDeadlineError("Canvas browser timed out"),
						);
					else {
						const index = queue.indexOf(entry);
						if (index >= 0) queue.splice(index, 1);
						metric.outcome = "rejected";
						metric.totalMs = metric.queueMs = Math.round(
							performance.now() - submitted,
						);
						report(metric);
						reject(new BrowserDeadlineError("Canvas browser queue timed out"));
					}
				}, timeoutMs);

				async function perform() {
					const started = performance.now();
					metric.queueMs = Math.round(started - submitted);
					let server: BrowserServer | undefined;
					let directory: string | undefined;
					let opening: Promise<Page> | undefined;
					let termination: Promise<void> | undefined;
					let launchStarted: number | undefined;
					let renderStarted: number | undefined;
					let workSettled = false;
					const remaining = () =>
						Math.max(1, timeoutMs - (performance.now() - submitted));
					function terminateBrowser(force = false) {
						const owned = server;
						// A launch can still be pending. Do not cache this no-op: its
						// eventual browser must be terminated too, even after we respond.
						if (!owned) return Promise.resolve();
						termination ??= (async () => {
							if (
								force ||
								!(await settlesWithin(owned.close(), cleanupMs / 2))
							) {
								metric.forcedKill = true;
								await owned.kill();
							}
						})();
						return termination;
					}
					const sample = () => {
						metric.workerRssPeakBytes = Math.max(
							metric.workerRssPeakBytes,
							process.memoryUsage().rss,
						);
						metric.machineFreeMinBytes = Math.min(
							metric.machineFreeMinBytes,
							freemem(),
						);
					};
					const sampling = setInterval(sample, 250);
					const work = Promise.resolve()
						.then(() =>
							execute({
								signal: controller.signal,
								page() {
									opening ??= (async () => {
										controller.signal.throwIfAborted();
										metric.prepareMs = Math.round(performance.now() - started);
										launchStarted = performance.now();
										const files = await (
											options.assets ?? canvasBrowserAssets
										)();
										controller.signal.throwIfAborted();
										directory = await mkdtemp(
											join(tmpdir(), "haunter-render-"),
										);
										controller.signal.throwIfAborted();
										server = await (
											options.launch ?? chromium.launchServer.bind(chromium)
										)({
											headless: true,
											chromiumSandbox: true,
											host: "127.0.0.1",
											timeout: Math.min(12_000, remaining()),
											env: canvasBrowserEnvironment(directory),
										});
										if (controller.signal.aborted) {
											await terminateBrowser(true);
											controller.signal.throwIfAborted();
										}
										const browser = await (
											options.connect ?? chromium.connect.bind(chromium)
										)(server.wsEndpoint(), { timeout: remaining() });
										controller.signal.throwIfAborted();
										const context = await createCanvasPreviewContext(
											browser,
											files,
										);
										const page = await context.newPage();
										await page.goto(canvasBrowserOrigin, {
											timeout: Math.min(5000, remaining()),
											waitUntil: "load",
										});
										controller.signal.throwIfAborted();
										metric.launchMs = Math.round(
											performance.now() - launchStarted,
										);
										renderStarted = performance.now();
										return page;
									})();
									return opening;
								},
							}),
						)
						.finally(() => {
							workSettled = true;
						});
					// Observe late rejections even when the request's deadline has expired.
					void work.catch(() => {});
					let value: T | undefined;
					let failure: unknown;
					const aborted = new Promise<never>((_, fail) => {
						controller.signal.addEventListener(
							"abort",
							() => fail(controller.signal.reason),
							{ once: true },
						);
					});
					try {
						value = await Promise.race([work, aborted]);
					} catch (error) {
						failure = error;
						metric.outcome =
							error instanceof BrowserDeadlineError ||
							(error instanceof Error && error.name === "TimeoutError")
								? "timeout"
								: error instanceof BrowserStoppedError
									? "stopped"
									: isAppError(error)
										? "invalid"
										: "error";
					}
					clearTimeout(deadline);
					if (renderStarted)
						metric.renderMs = Math.round(performance.now() - renderStarted);
					else if (launchStarted)
						metric.launchMs = Math.round(performance.now() - launchStarted);
					else if (!opening)
						metric.prepareMs = Math.round(performance.now() - started);
					const cleanupStarted = performance.now();
					controller.abort(
						new BrowserStoppedError("Canvas browser job finished"),
					);
					const cleanup = terminateBrowser();
					// Never grant another slot until timed-out preparation/late launch AND
					// browser termination finish. A stuck cleanup degrades only rendering.
					const drained = Promise.all([work.catch(() => {}), cleanup]).then(
						async () => {
							// Do not swallow a failed kill from a browser that launched
							// after cancellation while observing the work's rejection.
							await termination;
							if (directory)
								await rm(directory, { recursive: true, force: true });
						},
					);
					const cleaned = await settlesWithin(drained, cleanupMs);
					if (!cleaned) {
						failure ??= new Error("Canvas browser cleanup did not finish");
						metric.cleanupIncomplete = true;
						if (metric.outcome === "ok" || metric.outcome === "invalid")
							metric.outcome = "error";
					}
					metric.cleanupMs = Math.round(performance.now() - cleanupStarted);
					metric.totalMs = Math.round(performance.now() - submitted);
					sample();
					clearInterval(sampling);
					report(metric);
					if (cleaned && workSettled) advance();
					else
						void drained.then(advance, () => {
							/* Remain unavailable until restart. */
						});
					if (failure !== undefined) reject(failure);
					else resolve(value as T);
				}
				if (active) queue.push(entry);
				else entry.start();
			});
		},
		async stop() {
			stopped = true;
			state = "stopped";
			for (const entry of queue.splice(0)) entry.cancel();
			active?.abort();
			await active?.done;
		},
	};
}
export type CanvasBrowserRunner = ReturnType<typeof createCanvasBrowserRunner>;
