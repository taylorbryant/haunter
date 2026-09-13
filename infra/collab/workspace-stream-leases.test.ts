import { describe, expect, it } from "bun:test";
import {
	createWorkspaceEventStreamLeases,
	workspaceEventStreamLeaseKey,
} from "./workspace-stream-leases";

describe("workspace stream leases", () => {
	it("atomically caps leases per user and releases each token once", async () => {
		const calls: Array<{ keys: string[]; args: unknown[] }> = [];
		const removed: Array<{ key: string; members: unknown[] }> = [];
		let accepted = 1;
		const leases = createWorkspaceEventStreamLeases({
			prefix: "test",
			redis: {
				async eval<TArgs extends unknown[], TData = unknown>(
					_script: string,
					keys: string[],
					args: TArgs,
				) {
					calls.push({ keys, args });
					return accepted as TData;
				},
				async zrem<TData>(key: string, ...members: TData[]) {
					removed.push({ key, members });
					return members.length;
				},
			},
		});
		const lease = await leases.acquire({
			userId: "user_1",
			maxConnections: 8,
			ttlMs: 300_000,
		});
		expect(lease).not.toBeNull();
		expect(calls[0]?.keys).toEqual([
			workspaceEventStreamLeaseKey("test", "user_1"),
		]);
		expect(calls[0]?.args[3]).toBe(8);
		expect(calls[0]?.args[4]).toBe(360_000);
		await lease?.release();
		await lease?.release();
		expect(removed).toEqual([
			{
				key: workspaceEventStreamLeaseKey("test", "user_1"),
				members: [calls[0]?.args[2]],
			},
		]);
		accepted = 0;
		expect(
			await leases.acquire({
				userId: "user_1",
				maxConnections: 8,
				ttlMs: 300_000,
			}),
		).toBeNull();
	});
	it("disables admission without lease storage", async () => {
		const leases = createWorkspaceEventStreamLeases({
			redis: null,
			prefix: "test",
		});
		expect(leases.isConfigured()).toBe(false);
		expect(
			await leases.acquire({
				userId: "user_1",
				maxConnections: 8,
				ttlMs: 300_000,
			}),
		).toBeNull();
	});
});
