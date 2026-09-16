import { expect, test } from "bun:test";
import {
	type CachedPageAgentActivity,
	mergePageAgentActivity,
	visiblePageAgents,
} from "@/features/agents/client/page-activity-cache";
import { isPageAgentActivity } from "@/features/agents/page-activity";
import { pageActivityFixture } from "./page-activity-fixture";

test("authorized MCP reads publish attributed start and completion without page contents", async () => {
	const f = await pageActivityFixture();
	await f.execute();
	expect(f.events).toHaveLength(2);
	expect(f.events.every(isPageAgentActivity)).toBe(true);
	expect(f.events[0]).toMatchObject({
		phase: "active",
		action: "read",
		agentName: "Codex",
		userName: "Taylor",
		pageId: f.page.id,
	});
	expect(f.events[1]).toMatchObject({
		phase: "completed",
		operationId: f.events.find(isPageAgentActivity)?.operationId,
	});
	expect(JSON.stringify(f.events)).not.toContain("Release plan");
});

test("successful page edits announce the specific action and leave the saved result intact", async () => {
	const f = await pageActivityFixture();
	await expect(
		f.execute("update_page", { title: "Updated plan" }),
	).resolves.toMatchObject({ title: "Updated plan" });
	expect(
		f.events
			.filter(isPageAgentActivity)
			.map((event) => [event.action, event.phase]),
	).toEqual([
		["update", "active"],
		["update", "completed"],
	]);
	expect((await f.pages.findById(f.scope, f.page.id))?.title).toBe(
		"Updated plan",
	);
});

test("denied grants, membership, missing pages, and invalid inputs never show presence", async () => {
	const f = await pageActivityFixture({ profile: "view" });
	await expect(f.execute("update_page", { title: "No" })).rejects.toThrow();
	await expect(f.execute("read_page", { pageId: "invalid" })).rejects.toThrow();
	await expect(
		f.execute("read_page", { pageId: crypto.randomUUID() }),
	).rejects.toThrow();
	await expect(
		f.execute("read_page", { workspaceId: "another-workspace" }),
	).rejects.toThrow();
	f.setRole(null);
	await expect(f.execute()).rejects.toThrow();
	expect(f.events).toEqual([]);
});

test("viewer role denies editing presence even with an edit connection", async () => {
	const f = await pageActivityFixture({ role: "viewer" });
	await expect(f.execute("update_page", { title: "No" })).rejects.toThrow();
	expect(f.events).toEqual([]);
	await f.execute();
	expect(f.events).toHaveLength(2);
});

test("page authorization and unrelated capabilities do not announce activity", async () => {
	const f = await pageActivityFixture();
	await f.execute("list_pages");
	expect(f.events).toEqual([]);
	await f.pages.setDeletedByIds(f.scope, [f.page.id], new Date().toISOString());
	await expect(f.execute()).rejects.toThrow();
	expect(f.events).toEqual([]);
});

test("handler failures finish presence and a failing publisher cannot fail the operation", async () => {
	const f = await pageActivityFixture();
	f.ports.pages.findById = async () => {
		throw new Error("Database unavailable");
	};
	await expect(f.execute()).rejects.toThrow("Database unavailable");
	expect(f.events).toHaveLength(2);
	expect(f.events[1]).toMatchObject({ phase: "failed" });
	const healthy = await pageActivityFixture();
	healthy.ports.workspaceEvents.publish = async () => {
		throw new Error("Redis unavailable");
	};
	await expect(healthy.execute()).resolves.toMatchObject({
		pageId: healthy.page.id,
	});
});

test("disabled live transport adds no presence work", async () => {
	const f = await pageActivityFixture({ configured: false });
	await f.execute();
	expect(f.events).toEqual([]);
});

test.each(["page", "members"] as const)(
	"a stalled %s presence lookup does not block the MCP action or publish later",
	async (stage) => {
		const f = await pageActivityFixture();
		const blocked = Promise.withResolvers<void>();
		const findMeta = f.ports.pages.findMetaById;
		const listMembers = f.ports.members.listByWorkspace;
		let rosterReads = 0;
		f.ports.pages.findMetaById = async (...args) => {
			if (stage === "page") await blocked.promise;
			return findMeta(...args);
		};
		f.ports.members.listByWorkspace = async (...args) => {
			rosterReads += 1;
			if (stage === "members") await blocked.promise;
			return listMembers(...args);
		};
		// Release even on regression, then fail if the operation needed that release.
		let watchdogReleased = false;
		const watchdog = setTimeout(() => {
			watchdogReleased = true;
			blocked.resolve();
		}, 2_500);
		try {
			await expect(f.execute()).resolves.toMatchObject({ pageId: f.page.id });
			expect(watchdogReleased).toBe(false);
			expect(f.events).toEqual([]);
		} finally {
			clearTimeout(watchdog);
			blocked.resolve();
			await Bun.sleep(0);
		}
		expect(f.events).toEqual([]);
		expect(rosterReads).toBe(stage === "page" ? 0 : 1);
	},
);

test("a presence timeout preserves the page action's own authorization checks", async () => {
	const f = await pageActivityFixture();
	const blocked = Promise.withResolvers<void>();
	const findMeta = f.ports.pages.findMetaById;
	f.ports.pages.findMetaById = async (...args) => {
		await blocked.promise;
		return findMeta(...args);
	};
	// The actual page read still reaches its gate and must reject this resource.
	f.ports.pages.findById = async () => ({
		...f.page,
		content: [],
		workspaceId: "another-workspace",
	});
	let watchdogReleased = false;
	const watchdog = setTimeout(() => {
		watchdogReleased = true;
		blocked.resolve();
	}, 2_500);
	try {
		await expect(f.execute()).rejects.toThrow(
			"You do not have access to this page.",
		);
		expect(watchdogReleased).toBe(false);
	} finally {
		clearTimeout(watchdog);
		blocked.resolve();
		await Bun.sleep(0);
	}
	expect(f.events).toEqual([]);
});

test("initial publication uses the remaining preparation budget and still receives completion", async () => {
	const f = await pageActivityFixture();
	const blocked = Promise.withResolvers<void>();
	const listMembers = f.ports.members.listByWorkspace;
	f.ports.members.listByWorkspace = async (...args) => {
		await Bun.sleep(800);
		return listMembers(...args);
	};
	f.ports.workspaceEvents.publish = async (event) => {
		if (isPageAgentActivity(event) && event.phase === "active")
			await blocked.promise;
		f.events.push(event);
	};
	const started = performance.now();
	try {
		await expect(f.execute()).resolves.toMatchObject({ pageId: f.page.id });
		expect(performance.now() - started).toBeLessThan(1_700);
		expect(
			f.events.filter(isPageAgentActivity).map((event) => event.phase),
		).toEqual(["completed"]);
	} finally {
		blocked.resolve();
		await Bun.sleep(0);
	}
	const events = f.events.filter(isPageAgentActivity);
	expect(events.map((event) => event.phase)).toEqual(["completed", "active"]);
	const clock = { serverTime: Date.now(), receivedAt: performance.now() };
	const state = events.reduce<CachedPageAgentActivity[]>(
		(current, event) => mergePageAgentActivity(current, event, clock),
		[],
	);
	expect(visiblePageAgents(state, f.page.id)[0]?.phase).toBe("completed");
});

test("concurrent invocations have independent lifecycle identifiers", async () => {
	const f = await pageActivityFixture();
	await Promise.all([f.execute(), f.execute()]);
	const events = f.events.filter(isPageAgentActivity);
	const starts = events.filter((event) => event.phase === "active");
	expect(new Set(starts.map((event) => event.operationId)).size).toBe(2);
	for (const start of starts) {
		expect(
			events
				.filter((event) => event.operationId === start.operationId)
				.map((event) => event.phase),
		).toEqual(["active", "completed"]);
	}
});
