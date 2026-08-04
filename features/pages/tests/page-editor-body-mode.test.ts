import { describe, expect, it } from "bun:test";
import { pageEditorBodyMode } from "../components/page-editor-body-mode";

describe("page editor body mode", () => {
	it("keeps the fetched projection visible while collaboration connects", () => {
		expect(pageEditorBodyMode("connecting", false)).toBe("projection");
		expect(pageEditorBodyMode("connecting", true)).toBe("projection");
	});

	it("keeps the fetched projection visible while the live editor loads", () => {
		expect(pageEditorBodyMode("ready", false)).toBe("projection");
	});

	it("switches directly to the live editor once both are ready", () => {
		expect(pageEditorBodyMode("ready", true)).toBe("collaboration");
	});

	it("keeps the projection visible when collaboration is unavailable", () => {
		expect(pageEditorBodyMode("unavailable", true)).toBe("projection");
	});
});
