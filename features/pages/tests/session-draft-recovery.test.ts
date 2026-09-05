import { describe, expect, test } from "bun:test";
import { ContractError } from "@beignet/core/client";
import { DurableDraftController } from "@/client/durable-drafts";
import type { LocalDraft } from "@/client/local-drafts";
import { draftRegistry } from "@/client/draft-registry";

function fixture(
	options: {
		save?: (value: string) => Promise<{ value: string; version: string }>;
		delay?: number;
	} = {},
) {
	let stored: LocalDraft<string> | null = null;
	let rejectStorage = false;
	let calls = 0;
	const controller = new DurableDraftController<string>({
		identity: {
			key: crypto.randomUUID(),
			userId: "session-draft-test",
			workspaceId: "workspace",
			resourceId: "page",
			resourceType: "page",
		},
		serverValue: "Saved sentence",
		serverVersion: "v1",
		localDebounceMs: options.delay ?? 0,
		debounceMs: 1,
		isPayload: (value): value is string => typeof value === "string",
		storage: {
			load: async () => stored,
			persist: async (draft) => {
				if (rejectStorage) throw new Error("quota");
				stored = draft;
			},
			discard: async () => {
				stored = null;
			},
			acknowledge: async (_key, writeId, version) => {
				if (stored?.writeId === writeId) stored = null;
				else if (stored) stored = { ...stored, baseVersion: version };
				return stored;
			},
		},
		saveServer: async ({ value }) => {
			calls++;
			return options.save ? options.save(value) : { value, version: "v2" };
		},
	});
	controller.start();
	return {
		controller,
		get stored() {
			return stored;
		},
		get calls() {
			return calls;
		},
		failStorage() {
			rejectStorage = true;
		},
	};
}
async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Draft did not settle");
}

describe("session interruption during editing", () => {
	test.each([
		{ status: 401, code: "UNAUTHORIZED" },
		{ status: 401, code: "SESSION_PAUSED" },
	])(
		"a cancelled $code response cannot pause a newer save",
		async ({ status, code }) => {
			let rejectOld!: (error: unknown) => void;
			let finishNew!: (result: { value: string; version: string }) => void;
			const f = fixture({
				save: () =>
					f.calls === 1
						? new Promise((_resolve, reject) => {
								rejectOld = reject;
							})
						: new Promise((resolve) => {
								finishNew = resolve;
							}),
			});
			try {
				await waitFor(() => f.controller.getSnapshot().status === "saved");
				f.controller.edit("First");
				await waitFor(() => f.calls === 1);
				f.controller.pause();
				f.controller.edit("Latest");
				await f.controller.flushLocal();
				f.controller.resume();
				await waitFor(() => f.calls === 2);
				rejectOld(
					new ContractError({
						source: "http",
						status,
						code,
						message: "Old response",
					}),
				);
				await Bun.sleep(10);
				expect(f.controller.getSnapshot()).toMatchObject({
					status: "syncing",
					remotePaused: false,
				});
				finishNew({ value: "Latest", version: "v2" });
				await waitFor(() => f.controller.getSnapshot().status === "saved");
				expect(f.controller.getSnapshot().value).toBe("Latest");
				expect(f.stored).toBeNull();
				expect(f.calls).toBe(2);
			} finally {
				f.controller.stop();
			}
		},
	);
	test("a 401 pauses writes while further typing remains durable, then resumes the latest value", async () => {
		let authenticated = false;
		const f = fixture({
			save: async (value) => {
				if (!authenticated)
					throw new ContractError({
						source: "http",
						status: 401,
						message: "Unauthorized",
					});
				return { value, version: "v2" };
			},
		});
		try {
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			f.controller.edit("First sentence");
			await waitFor(() => f.controller.getSnapshot().status === "paused");
			f.controller.edit("First sentence. Second sentence.");
			await f.controller.flushLocal();
			expect(f.stored?.payload).toBe("First sentence. Second sentence.");
			expect(f.calls).toBe(1);
			expect(await f.controller.flushServer()).toBe(false);
			authenticated = true;
			f.controller.resume();
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			expect(f.calls).toBe(2);
			expect(f.stored).toBeNull();
		} finally {
			f.controller.stop();
		}
	});
	test("pausing an in-flight save retains its recovery copy even after success", async () => {
		let finish!: (result: { value: string; version: string }) => void;
		const f = fixture({
			save: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		try {
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			f.controller.edit("First");
			await waitFor(() => f.calls === 1);
			f.controller.pause();
			f.controller.edit("Latest");
			await f.controller.flushLocal();
			finish({ value: "First", version: "v2" });
			await Bun.sleep(10);
			expect(f.stored?.payload).toBe("Latest");
			expect(f.controller.getSnapshot()).toMatchObject({
				status: "paused",
				dirty: true,
				locallySaved: true,
			});
		} finally {
			f.controller.stop();
		}
	});
	test("pause during local flush does not leave a server flusher hanging", async () => {
		const f = fixture({ delay: 50 });
		try {
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			f.controller.edit("Keep this");
			const pending = f.controller.flushServer();
			f.controller.pause();
			const outcome = await Promise.race([
				pending,
				Bun.sleep(100).then(() => "hung"),
			]);
			expect(outcome).toBe(false);
		} finally {
			f.controller.stop();
		}
	});
	test("storage failure remains visible while paused and registry prevents unsafe navigation", async () => {
		const f = fixture();
		try {
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			f.controller.pause();
			f.failStorage();
			f.controller.edit("Memory only");
			expect(await draftRegistry.flushLocal("session-draft-test")).toBe(false);
			expect(f.controller.getSnapshot()).toMatchObject({
				status: "storage-error",
				locallySaved: false,
				value: "Memory only",
			});
		} finally {
			f.controller.stop();
		}
	});
	test("server refresh while paused preserves conflicts through resume", async () => {
		const f = fixture();
		try {
			await waitFor(() => f.controller.getSnapshot().status === "saved");
			f.controller.pause();
			f.controller.edit("Mine");
			await f.controller.flushLocal();
			f.controller.refreshServer("Theirs", "v3");
			f.controller.resume();
			expect(f.controller.getSnapshot()).toMatchObject({
				status: "conflict",
				value: "Mine",
				serverValue: "Theirs",
			});
			expect(f.calls).toBe(0);
		} finally {
			f.controller.stop();
		}
	});
});
