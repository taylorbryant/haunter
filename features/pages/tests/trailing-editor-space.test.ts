import { describe, expect, it } from "bun:test";
import type { BlockJson } from "@/features/pages/schemas";
import { needsEditableTrailingSpace } from "../components/editor/trailing-editor-space";

function block(type: string, content: unknown): BlockJson {
	return { id: type, type, props: {}, content, children: [] };
}

describe("editable trailing editor space", () => {
	it("reserves space after a non-empty final block", () => {
		expect(
			needsEditableTrailingSpace([
				block("paragraph", [{ type: "text", text: "Last line", styles: {} }]),
			]),
		).toBe(true);
		expect(needsEditableTrailingSpace([block("canvas", undefined)])).toBe(true);
	});

	it("does not reserve space when the document already ends in an empty paragraph", () => {
		expect(needsEditableTrailingSpace([block("paragraph", [])])).toBe(false);
		expect(needsEditableTrailingSpace([block("paragraph", undefined)])).toBe(
			false,
		);
	});

	it("does not reserve space for an empty document", () => {
		expect(needsEditableTrailingSpace([])).toBe(false);
	});
});
