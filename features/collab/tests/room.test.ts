import { describe, expect, it } from "bun:test";
import { parseRoomId, workspaceRoomId } from "../lib/room";

describe("workspace event room ids", () => {
	it("round-trips workspace ids", () => {
		const workspaceId = "workspace_abc-123";
		expect(parseRoomId(workspaceRoomId(workspaceId))).toEqual({
			kind: "workspace",
			id: workspaceId,
		});
	});

	it("rejects other room kinds and unsafe ids", () => {
		expect(parseRoomId("page:abc")).toBeNull();
		expect(parseRoomId("workspace:* OR 1=1")).toBeNull();
		expect(parseRoomId("workspace:abc:extra")).toBeNull();
		expect(parseRoomId("workspace:")).toBeNull();
		expect(parseRoomId("")).toBeNull();
	});
});
