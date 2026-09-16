import { expect, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	type CachedPageAgentActivity,
	clearPageAgentActivity,
	mergePageAgentActivity,
	pageAgentActivityKey,
	receivePageAgentActivity,
	visiblePageAgents,
} from "@/features/agents/client/page-activity-cache";
import {
	isPageAgentActivity,
	pageAgentActivityLabel,
} from "@/features/agents/page-activity";
import { activity } from "./page-activity-fixture";

const serverTime = Date.parse(activity().occurredAt);
const clock = { serverTime, receivedAt: 1_000 };
const pageId = activity().pageId;

function addUnrelatedActivityBurst(
	state: CachedPageAgentActivity[],
	now: number,
) {
	const occurredAt = new Date(
		serverTime + now - clock.receivedAt,
	).toISOString();
	for (let i = 0; i < 256; i++) {
		state = mergePageAgentActivity(
			state,
			activity({
				pageId: "00000000-0000-4000-8000-000000000099",
				operationId: crypto.randomUUID(),
				phase: "completed",
				occurredAt,
			}),
			clock,
			now,
		);
	}
	return state;
}

test("workspace activity bursts preserve active operations until their deadline", () => {
	const start = activity();
	let state = mergePageAgentActivity([], start, clock, 1_000);
	state = addUnrelatedActivityBurst(state, 2_000);
	expect(visiblePageAgents(state, pageId, 2_000)).toMatchObject([start]);
	expect(visiblePageAgents(state, pageId, 60_999)).toMatchObject([start]);
	expect(visiblePageAgents(state, pageId, 61_000)).toEqual([]);
	// The next arrival prunes expired records, even if that event is itself stale.
	expect(mergePageAgentActivity(state, start, clock, 62_000)).toEqual([]);
});

test.each(["completed", "failed"] as const)(
	"workspace activity bursts preserve hidden %s records against delayed starts",
	(phase) => {
		const start = activity();
		const terminal = activity({
			phase,
			occurredAt: new Date(serverTime + 1_000).toISOString(),
		});
		let state = mergePageAgentActivity([], terminal, clock, 2_000);
		state = addUnrelatedActivityBurst(state, 20_000);
		state = mergePageAgentActivity(state, start, clock, 21_000);
		expect(visiblePageAgents(state, pageId, 21_000)).toEqual([]);
		expect(
			state.find((item) => item.operationId === start.operationId),
		).toMatchObject(terminal);
		state = mergePageAgentActivity(state, start, clock, 62_000);
		expect(state.some((item) => item.operationId === start.operationId)).toBe(
			false,
		);
		expect(visiblePageAgents(state, pageId, 62_000)).toEqual([]);
	},
);

test.each([-300_000, 300_000])(
	"presence lifetimes ignore a browser clock offset of %d milliseconds",
	(offset) => {
		const wallClock = spyOn(Date, "now").mockReturnValue(serverTime + offset);
		try {
			const state = mergePageAgentActivity([], activity(), clock, 1_000);
			expect(visiblePageAgents(state, pageId, 1_000)).toHaveLength(1);
			expect(state[0]?.expiresAt).toBe(61_000);
			// Changing the wall clock mid-session cannot change existing or new deadlines.
			wallClock.mockReturnValue(serverTime - offset * 10);
			const done = activity({
				phase: "completed",
				occurredAt: new Date(serverTime + 5_000).toISOString(),
			});
			const completed = mergePageAgentActivity(state, done, clock, 6_000);
			expect(completed[0]?.expiresAt).toBe(21_000);
			expect(visiblePageAgents(completed, pageId, 20_999)).toHaveLength(1);
			expect(visiblePageAgents(completed, pageId, 21_000)).toEqual([]);
		} finally {
			wallClock.mockRestore();
		}
	},
);

test("delayed activity gets only its remaining display lifetime", () => {
	const done = activity({ phase: "completed" });
	const state = mergePageAgentActivity([], done, clock, 11_000);
	expect(state[0]?.expiresAt).toBe(16_000);
	expect(visiblePageAgents(state, pageId, 15_999)).toHaveLength(1);
	expect(visiblePageAgents(state, pageId, 16_000)).toEqual([]);
	expect(pageAgentActivityLabel(done)).toBe("Added content just now");
	expect(
		pageAgentActivityLabel(activity({ action: "read", phase: "completed" })),
	).toBe("Read just now");
});

test("completion survives an out-of-order start without restarting its lifetime", () => {
	const start = activity();
	const done = activity({
		phase: "completed",
		occurredAt: new Date(serverTime + 100).toISOString(),
	});
	let state = mergePageAgentActivity([], done, clock, 1_100);
	state = mergePageAgentActivity(state, start, clock, 1_200);
	expect(visiblePageAgents(state, pageId, 1_300)).toMatchObject([done]);
	expect(visiblePageAgents(state, pageId, 16_100)).toEqual([]);
	state = mergePageAgentActivity(state, start, clock, 17_000);
	expect(visiblePageAgents(state, pageId, 17_000)).toEqual([]);
});

test.each(["completed", "failed"] as const)(
	"delayed %s events clear presence even when their display lifetime has expired",
	(phase) => {
		const start = activity();
		const terminal = activity({
			phase,
			occurredAt: new Date(serverTime + 1_000).toISOString(),
		});
		const started = mergePageAgentActivity([], start, clock, 1_000);
		for (const initial of [started, []]) {
			let state = mergePageAgentActivity(initial, terminal, clock, 21_000);
			expect(state).toMatchObject([terminal]);
			expect(visiblePageAgents(state, pageId, 21_000)).toEqual([]);
			state = mergePageAgentActivity(state, start, clock, 22_000);
			expect(visiblePageAgents(state, pageId, 22_000)).toEqual([]);
		}
		expect(mergePageAgentActivity([], terminal, clock, 62_000)).toEqual([]);
	},
);

test("a delayed completion preserves another active operation by the same agent", () => {
	const start = activity();
	const newer = activity({
		operationId: crypto.randomUUID(),
		startedAt: new Date(serverTime + 10_000).toISOString(),
		occurredAt: new Date(serverTime + 10_000).toISOString(),
	});
	let state = mergePageAgentActivity([], start, clock, 1_000);
	state = mergePageAgentActivity(state, newer, clock, 11_000);
	state = mergePageAgentActivity(
		state,
		activity({
			phase: "completed",
			occurredAt: new Date(serverTime + 1_000).toISOString(),
		}),
		clock,
		21_000,
	);
	expect(visiblePageAgents(state, pageId, 21_000)).toMatchObject([newer]);
});

test("duplicate activity cannot extend its deadline and active calls expire locally", () => {
	const start = activity();
	const state = mergePageAgentActivity([], start, clock, 1_000);
	// Even a newly calibrated clock must not give duplicate events a new lifetime.
	const duplicate = mergePageAgentActivity(
		state,
		start,
		{ serverTime, receivedAt: 11_000 },
		11_000,
	);
	expect(duplicate).toEqual(state);
	expect(visiblePageAgents(duplicate, pageId, 60_999)).toHaveLength(1);
	expect(visiblePageAgents(duplicate, pageId, 61_000)).toEqual([]);
	expect(visiblePageAgents(duplicate, "another-page", 1_000)).toEqual([]);
});

test("slightly future-dated events from reference latency receive at most a full lifetime", () => {
	const event = activity({
		occurredAt: new Date(serverTime + 100).toISOString(),
	});
	const state = mergePageAgentActivity([], event, clock, 1_000);
	expect(state[0]?.expiresAt).toBe(61_000);
});

test("cache isolates viewers/workspaces and clears when a connection is lost or renewed", () => {
	const queryClient = new QueryClient();
	const event = activity();
	const liveClock = { serverTime, receivedAt: performance.now() };
	receivePageAgentActivity(
		queryClient,
		"viewer",
		"other-workspace",
		event,
		liveClock,
	);
	expect(
		queryClient.getQueryData(pageAgentActivityKey("viewer", "other-workspace")),
	).toBeUndefined();
	receivePageAgentActivity(
		queryClient,
		"viewer",
		event.workspaceId,
		event,
		liveClock,
	);
	expect(
		queryClient.getQueryData(
			pageAgentActivityKey("another-viewer", event.workspaceId),
		),
	).toBeUndefined();
	expect(
		queryClient.getQueryData<CachedPageAgentActivity[]>(
			pageAgentActivityKey("viewer", event.workspaceId),
		),
	).toMatchObject([event]);
	clearPageAgentActivity(queryClient, "viewer", event.workspaceId);
	expect(
		queryClient.getQueryData<CachedPageAgentActivity[]>(
			pageAgentActivityKey("viewer", event.workspaceId),
		),
	).toEqual([]);
	queryClient.clear();
});

test("malformed transport activity is rejected", () => {
	expect(isPageAgentActivity(activity())).toBe(true);
	expect(isPageAgentActivity(activity({ occurredAt: "invalid" }))).toBe(false);
	expect(isPageAgentActivity({ ...activity(), phase: "thinking" })).toBe(false);
});
