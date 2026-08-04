import { describe, expect, it } from "bun:test";
import { presencePeersFromOthers } from "@/features/collab/client/presence-state";

describe("presencePeersFromOthers", () => {
	it("deduplicates human tabs and preserves server-published agent status", () => {
		const peers = presencePeersFromOthers([
			{
				connectionId: 1,
				id: "user_1",
				info: { name: "Taylor" },
				presence: {},
			},
			{
				connectionId: 2,
				id: "user_1",
				info: { name: "Taylor" },
				presence: {},
			},
			{
				connectionId: 3,
				id: "agent:run_1",
				info: { name: "Codex", color: "#a855f7" },
				presence: {
					kind: "agent",
					status: "editing",
					capability: "append_to_page",
				},
			},
		]);

		expect(peers).toHaveLength(2);
		expect(peers[0]).toMatchObject({
			id: "user_1",
			name: "Taylor",
			kind: "human",
		});
		expect(peers[1]).toEqual({
			id: "agent:run_1",
			name: "Codex",
			color: "#a855f7",
			kind: "agent",
			status: "editing",
		});
	});

	it("treats malformed agent presence as a human collaborator", () => {
		expect(
			presencePeersFromOthers([
				{
					connectionId: 4,
					id: "agent:invalid",
					info: {},
					presence: { kind: "agent", status: "not-a-real-status" },
				},
			]),
		).toEqual([
			expect.objectContaining({
				id: "agent:invalid",
				name: "Collaborator",
				kind: "human",
			}),
		]);
	});
});
