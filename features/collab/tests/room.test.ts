import { describe, expect, it } from "bun:test";
import {
	cursorColorFor,
	documentRoomId,
	liveblocksSessionOptions,
	parseRoomId,
	workspaceRoomId,
} from "../lib/room";

describe("room ids", () => {
	it("round-trips page and canvas ids", () => {
		const pageId = crypto.randomUUID();
		const canvasId = crypto.randomUUID();
		expect(parseRoomId(documentRoomId("page", pageId))).toEqual({
			kind: "page",
			id: pageId,
		});
		expect(parseRoomId(documentRoomId("canvas", canvasId))).toEqual({
			kind: "canvas",
			id: canvasId,
		});
	});

	it("parses workspace event rooms without treating them as documents", () => {
		expect(parseRoomId(workspaceRoomId("workspace_123-abc"))).toEqual({
			kind: "workspace",
			id: "workspace_123-abc",
		});
		expect(parseRoomId("workspace:has:extra")).toBeNull();
		expect(parseRoomId("workspace:../other")).toBeNull();
	});

	it("rejects legacy and malformed document room ids", () => {
		expect(parseRoomId("page:not-a-uuid")).toBeNull();
		expect(parseRoomId(`page:${crypto.randomUUID()}`)).toBeNull();
		expect(parseRoomId(`canvas:${crypto.randomUUID()}`)).toBeNull();
		expect(parseRoomId(`task:${crypto.randomUUID()}`)).toBeNull();
		expect(parseRoomId(`page:${crypto.randomUUID()}:extra`)).toBeNull();
		expect(parseRoomId("page:")).toBeNull();
		expect(parseRoomId("")).toBeNull();
		// SQL-ish / traversal-ish garbage must not survive parsing.
		expect(parseRoomId("page:* OR 1=1")).toBeNull();
	});

	it("scopes access tokens to the room's workspace organization", () => {
		expect(
			liveblocksSessionOptions({
				workspaceId: "workspace_1",
				userName: "Taylor",
			}),
		).toEqual({
			organizationId: "workspace_1",
			userInfo: { name: "Taylor" },
		});
	});

	it("assigns stable colors per user", () => {
		const color = cursorColorFor("user_abc");
		expect(cursorColorFor("user_abc")).toBe(color);
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});
});
