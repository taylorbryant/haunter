import { describe, expect, it } from "bun:test";
import { taskAttributionsForChanges } from "@/features/pages/lib/collab-document";

describe("collaborative page document mutations", () => {
	it("attributes only locally-authored task assignment changes", () => {
		const attributions = taskAttributionsForChanges([
			{
				type: "insert",
				block: {
					id: "local-task",
					type: "task",
					props: { assignee: "member-2" },
				},
				source: { type: "local" },
			},
			{
				type: "insert",
				block: {
					id: "remote-task",
					type: "task",
					props: { assignee: "member-3" },
				},
				source: { type: "yjs-remote" },
			},
		]);

		expect(attributions).toEqual([
			{ blockId: "local-task", assignee: "member-2" },
		]);
	});
});
