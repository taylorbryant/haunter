import { describe, expect, it } from "bun:test";
import { pagePresenceTarget } from "@/features/agents/presence";

const pageId = "11111111-1111-4111-8111-111111111111";

describe("agent page presence", () => {
	it("describes user-visible page operations without exposing list activity", () => {
		expect(pagePresenceTarget("read_page", { pageId })).toEqual({
			pageId,
			status: "reading",
		});
		expect(pagePresenceTarget("append_to_page", { pageId })).toEqual({
			pageId,
			status: "editing",
		});
		expect(
			pagePresenceTarget("update_page", { pageId, title: "Renamed" }),
		).toEqual({ pageId, status: "editing" });
		expect(pagePresenceTarget("update_page", { pageId, icon: "👻" })).toEqual({
			pageId,
			status: "organizing",
		});
		expect(pagePresenceTarget("archive_page", { pageId })).toEqual({
			pageId,
			status: "organizing",
		});
		expect(
			pagePresenceTarget("list_pages", { workspaceId: "workspace" }),
		).toBeNull();
	});

	it("uses a parent room while creating a subpage and the new room afterward", () => {
		const parentPageId = "22222222-2222-4222-8222-222222222222";
		expect(pagePresenceTarget("create_page", { parentPageId })).toEqual({
			pageId: parentPageId,
			status: "creating",
		});
		expect(pagePresenceTarget("create_page", {}, { pageId })).toEqual({
			pageId,
			status: "creating",
		});
	});
});
