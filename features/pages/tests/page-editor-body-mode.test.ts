import { describe, expect, it } from "bun:test";
import { pageEditorBodyMode } from "../components/page-editor-body-mode";

describe("page editor body mode", () => {
	it("keeps a stable skeleton visible while collaboration connects", () => {
		expect(pageEditorBodyMode("connecting", false)).toBe("loading");
		expect(pageEditorBodyMode("connecting", true)).toBe("loading");
	});

	it("keeps the skeleton visible while the live editor loads", () => {
		expect(pageEditorBodyMode("ready", false)).toBe("loading");
	});

	it("switches directly to the live editor once both are ready", () => {
		expect(pageEditorBodyMode("ready", true)).toBe("collaboration");
	});

	it("uses the projection only when collaboration is unavailable", () => {
		expect(pageEditorBodyMode("unavailable", true)).toBe("fallback");
	});

	it("uses the projection when the editor bundle fails to load", () => {
		expect(pageEditorBodyMode("ready", false, true)).toBe("fallback");
	});
});
