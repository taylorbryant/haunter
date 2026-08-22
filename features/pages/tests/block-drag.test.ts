import { expect, test } from "bun:test";
import { finishBlockDrag } from "@/features/pages/components/editor/block-drag";

test("finishing a block drag releases the frozen side menu", () => {
	const calls: string[] = [];

	finishBlockDrag({
		blockDragEnd: () => calls.push("drag-end"),
		unfreezeMenu: () => calls.push("unfreeze"),
	});

	expect(calls).toEqual(["drag-end", "unfreeze"]);
});
