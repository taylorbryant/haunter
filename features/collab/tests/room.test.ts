import { describe, expect, it } from "bun:test";
import {
	canvasRoomId,
	cursorColorFor,
	pageRoomId,
	parseRoomId,
} from "../lib/room";

describe("room ids", () => {
	it("round-trips page and canvas ids", () => {
		const pageId = crypto.randomUUID();
		const canvasId = crypto.randomUUID();
		expect(parseRoomId(pageRoomId(pageId))).toEqual({
			kind: "page",
			id: pageId,
		});
		expect(parseRoomId(canvasRoomId(canvasId))).toEqual({
			kind: "canvas",
			id: canvasId,
		});
	});

	it("rejects anything that is not <kind>:<uuid>", () => {
		expect(parseRoomId("page:not-a-uuid")).toBeNull();
		expect(parseRoomId(`task:${crypto.randomUUID()}`)).toBeNull();
		expect(parseRoomId(`page:${crypto.randomUUID()}:extra`)).toBeNull();
		expect(parseRoomId("page:")).toBeNull();
		expect(parseRoomId("")).toBeNull();
		// SQL-ish / traversal-ish garbage must not survive parsing.
		expect(parseRoomId("page:* OR 1=1")).toBeNull();
	});

	it("assigns stable colors per user", () => {
		const color = cursorColorFor("user_abc");
		expect(cursorColorFor("user_abc")).toBe(color);
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});
});
