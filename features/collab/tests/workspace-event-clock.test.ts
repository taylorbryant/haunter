import { expect, spyOn, test } from "bun:test";
import {
	createWorkspaceEventClockFetch,
	estimatedWorkspaceServerTime,
	readWorkspaceEventClock,
} from "../client/event-clock";
import { WORKSPACE_EVENT_TIME_HEADER } from "../headers";

function response(serverTime?: string, status = 200) {
	return new Response("stream", {
		status,
		headers:
			serverTime === undefined
				? {}
				: { [WORKSPACE_EVENT_TIME_HEADER]: serverTime },
	});
}

test("clock references use only server time and monotonic elapsed time", () => {
	const clock = readWorkspaceEventClock({ serverTime: 1_000_000 }, 500);
	expect(clock).toEqual({ serverTime: 1_000_000, receivedAt: 500 });
	if (!clock) throw new Error("Expected a clock reference");
	expect(estimatedWorkspaceServerTime(clock, 1_500)).toBe(1_001_000);
	for (const invalid of [
		null,
		{},
		{ serverTime: "1000" },
		{ serverTime: NaN },
		{ serverTime: Infinity },
		{ serverTime: -1 },
		{ serverTime: 9e15 },
	]) {
		expect(readWorkspaceEventClock(invalid, 500)).toBeNull();
	}
});

test("each stream resets the clock and an obsolete response cannot overwrite it", async () => {
	const now = spyOn(performance, "now").mockReturnValue(100);
	const requests: Array<ReturnType<typeof Promise.withResolvers<Response>>> =
		[];
	const clock = createWorkspaceEventClockFetch(async () => {
		const request = Promise.withResolvers<Response>();
		requests.push(request);
		return request.promise;
	});
	try {
		const first = clock.fetch("/api/broadcasts");
		requests[0]?.resolve(response("1000000"));
		await first;
		expect(clock.getClock()).toEqual({
			serverTime: 1_000_000,
			receivedAt: 100,
		});
		const obsolete = clock.fetch("/api/broadcasts");
		expect(clock.getClock()).toBeNull();
		const controller = new AbortController();
		const replacement = clock.fetch("/api/broadcasts", {
			signal: controller.signal,
		});
		now.mockReturnValue(2_000);
		requests[2]?.resolve(response("2000000"));
		await replacement;
		requests[1]?.resolve(response("0"));
		await obsolete;
		expect(clock.getClock()).toEqual({
			serverTime: 2_000_000,
			receivedAt: 2_000,
		});
		controller.abort();
		expect(clock.getClock()).toBeNull();
		const last = clock.fetch("/api/broadcasts");
		clock.clear();
		requests[3]?.resolve(response("3000000"));
		await last;
		expect(clock.getClock()).toBeNull();
	} finally {
		now.mockRestore();
	}
});

test("missing or invalid clock headers leave the stream usable without guessing browser time", async () => {
	for (const value of [
		undefined,
		"",
		"invalid",
		"-1",
		"Infinity",
		"9e15",
		"9000000000000000",
	]) {
		const stream = response(value);
		const clock = createWorkspaceEventClockFetch(async () => stream);
		expect(await clock.fetch("/api/broadcasts")).toBe(stream);
		expect(clock.getClock()).toBeNull();
		expect(await stream.text()).toBe("stream");
	}
});

test("failed and aborted requests cannot supply a clock reference", async () => {
	const controller = new AbortController();
	controller.abort();
	const clock = createWorkspaceEventClockFetch(async () => response("1000"));
	await clock.fetch("/api/broadcasts", { signal: controller.signal });
	expect(clock.getClock()).toBeNull();
	const failed = createWorkspaceEventClockFetch(async () =>
		response("1000", 401),
	);
	await failed.fetch("/api/broadcasts");
	expect(failed.getClock()).toBeNull();
});
