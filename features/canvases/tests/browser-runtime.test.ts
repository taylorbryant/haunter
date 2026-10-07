import { expect, test } from "bun:test";
import type { Browser, BrowserServer, chromium } from "playwright";
import { appError } from "@/features/shared/errors";
import {
	canvasBrowserEnvironment,
	createCanvasBrowserRunner,
	type CanvasBrowserMetric,
} from "@/infra/canvases/browser-runtime";

function gate<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function until(predicate: () => boolean) {
	const deadline = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Condition did not become true");
		await Bun.sleep(5);
	}
}

function browserFixture() {
	const calls = { launched: 0, closed: 0, killed: 0, connected: 0 };
	const server = {
		wsEndpoint: () => "ws://127.0.0.1/fake-browser",
		async close() {
			calls.closed++;
		},
		async kill() {
			calls.killed++;
		},
	} as unknown as BrowserServer;
	const browser = {
		async newContext() {
			return {
				async route() {},
				async routeWebSocket() {},
				async newPage() {
					return { async goto() {} };
				},
			};
		},
	} as unknown as Browser;
	const options = {
		async launch() {
			calls.launched++;
			return server;
		},
		async connect() {
			calls.connected++;
			return browser;
		},
		async assets() {
			return new Map();
		},
	};
	return { calls, server, options };
}

test("preview preparation and native layout share FIFO admission with only two waiting jobs", async () => {
	const runner = createCanvasBrowserRunner();
	const entered: string[] = [];
	const release = gate();
	const first = runner.run("preview", async () => {
		entered.push("decode");
		await release.promise;
	});
	const second = runner.run("structure", async () => {
		entered.push("layout");
	});
	const third = runner.run("preview", async () => {
		entered.push("decode again");
	});
	await expect(
		runner.run("preview", async () => {
			entered.push("overflow");
		}),
	).rejects.toThrow("unavailable");
	expect(entered).toEqual(["decode"]);
	expect(runner.health()).toMatchObject({
		active: true,
		queued: 2,
		rejected: 1,
	});
	release.resolve();
	await Promise.all([first, second, third]);
	expect(entered).toEqual(["decode", "layout", "decode again"]);
	expect(runner.health()).toMatchObject({
		ready: true,
		active: false,
		queued: 0,
		completed: 3,
	});
	await runner.stop();
});

test("queue wait counts against the deadline and expired jobs never prepare", async () => {
	const release = gate();
	const runner = createCanvasBrowserRunner({ timeoutMs: 40, cleanupMs: 10 });
	const first = runner
		.run("preview", async () => {
			await release.promise;
		})
		.catch((error) => error);
	let prepared = false;
	const second = runner
		.run("structure", async () => {
			prepared = true;
		})
		.catch((error) => error);
	expect(await second).toBeInstanceOf(Error);
	expect(await first).toBeInstanceOf(Error);
	expect(prepared).toBe(false);
	expect(runner.health()).toMatchObject({
		active: true,
		queued: 0,
		ready: false,
	});
	release.resolve();
	await until(() => !runner.health().active);
	await runner.stop();
});

test("timed-out decoding retains its slot until settled and cannot launch a late browser", async () => {
	const fixture = browserFixture();
	const metrics: CanvasBrowserMetric[] = [];
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		timeoutMs: 40,
		cleanupMs: 10,
		onMetric: (m) => metrics.push(m),
	});
	const release = gate();
	await expect(
		runner.run("preview", async (job) => {
			await release.promise;
			await job.page();
		}),
	).rejects.toThrow("timed out");
	expect(metrics[0]).toMatchObject({
		outcome: "timeout",
		cleanupIncomplete: true,
	});
	let nextStarted = false;
	const next = runner.run("structure", async () => {
		nextStarted = true;
	});
	expect(nextStarted).toBe(false);
	release.resolve();
	await next;
	expect(fixture.calls.launched).toBe(0);
	expect(runner.health()).toMatchObject({
		ready: true,
		failed: 1,
		completed: 1,
	});
	await runner.stop();
});

test("a browser launched after cancellation is killed before another job starts", async () => {
	const fixture = browserFixture();
	const launched = gate<BrowserServer>();
	const killed = gate();
	fixture.server.kill = async () => {
		fixture.calls.killed++;
		await killed.promise;
	};
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		timeoutMs: 100,
		cleanupMs: 10,
		launch: async () => {
			fixture.calls.launched++;
			return launched.promise;
		},
	});
	const first = runner
		.run("preview", async (job) => {
			await job.page();
		})
		.catch((error) => error);
	await until(() => fixture.calls.launched === 1);
	expect(await first).toBeInstanceOf(Error);
	let nextStarted = false;
	const next = runner.run("structure", async () => {
		nextStarted = true;
	});
	launched.resolve(fixture.server);
	await until(() => fixture.calls.killed === 1);
	expect(fixture.calls.connected).toBe(0);
	expect(nextStarted).toBe(false);
	killed.resolve();
	await next;
	expect(nextStarted).toBe(true);
	await runner.stop();
});

test("render deadline closes the browser, and stuck graceful close escalates to kill", async () => {
	const fixture = browserFixture();
	const terminated = gate();
	const metrics: CanvasBrowserMetric[] = [];
	fixture.server.close = async () => {
		fixture.calls.closed++;
		await terminated.promise;
	};
	fixture.server.kill = async () => {
		fixture.calls.killed++;
		terminated.resolve();
	};
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		timeoutMs: 80,
		cleanupMs: 40,
		onMetric: (m) => metrics.push(m),
	});
	await expect(
		runner.run("preview", async (job) => {
			await job.page();
			await terminated.promise;
		}),
	).rejects.toThrow("timed out");
	expect(fixture.calls).toMatchObject({ closed: 1, killed: 1 });
	expect(metrics[0]).toMatchObject({
		outcome: "timeout",
		forcedKill: true,
		cleanupIncomplete: false,
	});
	expect(runner.health().active).toBe(false);
	await runner.stop();
});

test("a failed kill after a late launch leaves rendering unavailable", async () => {
	const fixture = browserFixture();
	const launched = gate<BrowserServer>();
	fixture.server.kill = async () => {
		fixture.calls.killed++;
		throw new Error("Kill failed");
	};
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		timeoutMs: 100,
		cleanupMs: 10,
		launch: async () => {
			fixture.calls.launched++;
			return launched.promise;
		},
	});
	const first = runner
		.run("preview", async (job) => {
			await job.page();
		})
		.catch((error) => error);
	await until(() => fixture.calls.launched === 1);
	expect(await first).toBeInstanceOf(Error);
	launched.resolve(fixture.server);
	await until(() => fixture.calls.killed === 1);
	let nextStarted = false;
	await expect(
		runner.run("structure", async () => {
			nextStarted = true;
		}),
	).rejects.toThrow("queue timed out");
	expect(nextStarted).toBe(false);
	expect(runner.health()).toMatchObject({ active: true, ready: false });
	await runner.stop();
});

test("unconfirmed browser termination holds the slot even after returning an error", async () => {
	const fixture = browserFixture();
	const close = gate();
	const kill = gate();
	fixture.server.close = () => close.promise;
	fixture.server.kill = () => kill.promise;
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		timeoutMs: 500,
		cleanupMs: 20,
	});
	await expect(
		runner.run("preview", async (job) => {
			await job.page();
		}),
	).rejects.toThrow("cleanup");
	let nextStarted = false;
	const next = runner.run("structure", async () => {
		nextStarted = true;
	});
	expect(nextStarted).toBe(false);
	expect(runner.health()).toMatchObject({ active: true, ready: false });
	kill.resolve();
	await next;
	close.resolve();
	await runner.stop();
});

test("shutdown cancels active and queued jobs and never starts their browser", async () => {
	const fixture = browserFixture();
	const runner = createCanvasBrowserRunner(fixture.options);
	const preparing = gate();
	let prepared = 0;
	const active = runner
		.run("preview", async (job) => {
			preparing.resolve();
			await new Promise<void>((resolve) =>
				job.signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			await job.page();
		})
		.catch((error) => error);
	const queued = runner
		.run("structure", async () => {
			prepared++;
		})
		.catch((error) => error);
	await preparing.promise;
	await runner.stop();
	expect(await active).toBeInstanceOf(Error);
	expect(await queued).toBeInstanceOf(Error);
	expect(prepared).toBe(0);
	expect(fixture.calls.launched).toBe(0);
	expect(runner.health()).toMatchObject({
		state: "stopped",
		active: false,
		queued: 0,
	});
	await expect(runner.run("preview", async () => {})).rejects.toThrow(
		"unavailable",
	);
});

test("errors degrade rendering, valid jobs recover it, and invalid input is not a service failure", async () => {
	const metrics: CanvasBrowserMetric[] = [];
	const runner = createCanvasBrowserRunner({
		onMetric: (m) => metrics.push(m),
	});
	await expect(
		runner.run("preview", async () => {
			throw new Error("private document or secret");
		}),
	).rejects.toThrow();
	expect(runner.health().state).toBe("degraded");
	await runner.run("structure", async () => {});
	await expect(
		runner.run("preview", async () => {
			throw appError("InvalidCanvasPreview", { message: "private shape data" });
		}),
	).rejects.toThrow();
	expect(runner.health()).toMatchObject({
		ready: true,
		failed: 1,
		completed: 1,
	});
	expect(metrics.map((m) => m.outcome)).toEqual(["error", "ok", "invalid"]);
	expect(JSON.stringify(metrics)).not.toContain("private");
	expect(metrics[0].workerRssPeakBytes).toBeGreaterThan(0);
	expect(metrics[0].machineFreeMinBytes).toBeGreaterThan(0);
	await runner.stop();
});

test("Chromium always has its sandbox, loopback control socket and isolated environment", async () => {
	const fixture = browserFixture();
	let launchOptions: Parameters<typeof chromium.launchServer>[0];
	const runner = createCanvasBrowserRunner({
		...fixture.options,
		launch: async (options) => {
			launchOptions = options;
			return fixture.server;
		},
	});
	await runner.run("preview", async (job) => {
		await job.page();
	});
	expect(launchOptions).toMatchObject({
		chromiumSandbox: true,
		host: "127.0.0.1",
		headless: true,
	});
	expect(Object.keys(launchOptions?.env ?? {}).sort()).toEqual([
		"HOME",
		"LANG",
		"PATH",
		"TMPDIR",
		"TZ",
	]);
	expect(launchOptions?.env?.HOME).toContain("haunter-render-");
	expect(launchOptions?.env?.TMPDIR).toBe(launchOptions?.env?.HOME);
	expect(canvasBrowserEnvironment("/isolated").HOME).toBe("/isolated");
	await runner.stop();
});
