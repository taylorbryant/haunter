import { describe, expect, test } from "bun:test";
import { removeBlockFromSideMenu } from "../components/editor/remove-block-from-side-menu";

describe("removeBlockFromSideMenu", () => {
	test("unfreezes the side menu before removing its anchor block", () => {
		const calls: string[] = [];
		const hoveredBlock = { id: "hovered" };

		removeBlockFromSideMenu({
			hoveredBlock,
			unfreezeMenu: () => calls.push("unfreeze"),
			removeBlocks: (blocks) => calls.push(`remove:${blocks[0]?.id}`),
		});

		expect(calls).toEqual(["unfreeze", "remove:hovered"]);
	});

	test("removes the full selection when it contains the hovered block", () => {
		const removed: { id: string }[][] = [];
		const hoveredBlock = { id: "second" };
		const selectedBlocks = [{ id: "first" }, hoveredBlock];

		removeBlockFromSideMenu({
			hoveredBlock,
			selectedBlocks,
			unfreezeMenu: () => {},
			removeBlocks: (blocks) => removed.push(blocks),
		});

		expect(removed).toEqual([selectedBlocks]);
	});

	test("removes only the hovered block when it is outside the selection", () => {
		const removed: { id: string }[][] = [];
		const hoveredBlock = { id: "hovered" };

		removeBlockFromSideMenu({
			hoveredBlock,
			selectedBlocks: [{ id: "selected" }],
			unfreezeMenu: () => {},
			removeBlocks: (blocks) => removed.push(blocks),
		});

		expect(removed).toEqual([[hoveredBlock]]);
	});
});
