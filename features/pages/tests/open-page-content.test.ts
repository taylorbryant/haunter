import { describe, expect, it } from "bun:test";
import {
	appendSubpageLinkToOpenPage,
	registerSubpageLinkAppender,
} from "@/features/pages/client/open-page-content";

const child = {
	id: "00000000-0000-4000-8000-000000000002",
	workspaceId: "workspace-1",
};

describe("open page content mutations", () => {
	it("applies a subpage link through the registered collaborative editor", () => {
		const calls: unknown[][] = [];
		const unregister = registerSubpageLinkAppender(
			"00000000-0000-4000-8000-000000000001",
			(...args) => {
				calls.push(args);
				return true;
			},
		);

		const applied = appendSubpageLinkToOpenPage(
			"00000000-0000-4000-8000-000000000001",
			child,
			"2026-07-16T20:00:00.000Z",
		);
		unregister();

		expect(applied).toBe(true);
		expect(calls).toEqual([[child, "2026-07-16T20:00:00.000Z"]]);
	});

	it("falls back when no collaborative editor is registered", () => {
		expect(
			appendSubpageLinkToOpenPage(
				"00000000-0000-4000-8000-000000000003",
				child,
				"2026-07-16T20:00:00.000Z",
			),
		).toBe(false);
	});

	it("falls back when the registered editor cannot apply the block", () => {
		const pageId = "00000000-0000-4000-8000-000000000005";
		const unregister = registerSubpageLinkAppender(pageId, () => false);

		const applied = appendSubpageLinkToOpenPage(
			pageId,
			child,
			"2026-07-16T20:00:00.000Z",
		);
		unregister();

		expect(applied).toBe(false);
	});

	it("falls back when the registered editor throws", () => {
		const pageId = "00000000-0000-4000-8000-000000000006";
		const unregister = registerSubpageLinkAppender(pageId, () => {
			throw new Error("Editor was disposed");
		});

		const applied = appendSubpageLinkToOpenPage(
			pageId,
			child,
			"2026-07-16T20:00:00.000Z",
		);
		unregister();

		expect(applied).toBe(false);
	});

	it("does not let stale cleanup remove a newer registration", () => {
		const pageId = "00000000-0000-4000-8000-000000000004";
		const first = registerSubpageLinkAppender(pageId, () => true);
		let called = false;
		const second = registerSubpageLinkAppender(pageId, () => {
			called = true;
			return true;
		});

		first();
		appendSubpageLinkToOpenPage(pageId, child, "2026-07-16T20:00:00.000Z");
		second();

		expect(called).toBe(true);
	});
});
