import { describe, expect, it } from "bun:test";
import { cursorColorFor, pageRoomId, parsePageRoomId } from "../lib/room";

describe("page room ids", () => {
	it("round-trips a page id", () => {
		const pageId = crypto.randomUUID();
		expect(parsePageRoomId(pageRoomId(pageId))).toBe(pageId);
	});

	it("rejects anything that is not page:<uuid>", () => {
		expect(parsePageRoomId("page:not-a-uuid")).toBeNull();
		expect(parsePageRoomId(`canvas:${crypto.randomUUID()}`)).toBeNull();
		expect(parsePageRoomId(`page:${crypto.randomUUID()}:extra`)).toBeNull();
		expect(parsePageRoomId("")).toBeNull();
		// SQL-ish / traversal-ish garbage must not survive parsing.
		expect(parsePageRoomId("page:* OR 1=1")).toBeNull();
	});

	it("assigns stable colors per user", () => {
		const color = cursorColorFor("user_abc");
		expect(cursorColorFor("user_abc")).toBe(color);
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});
});
