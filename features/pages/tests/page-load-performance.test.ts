import { describe, expect, it } from "bun:test";
import {
	createPageLoadLifecycle,
	pageIdFromPagePathname,
} from "@/features/pages/client/page-load-performance";

describe("page-load performance lifecycle", () => {
	it("preserves navigation intent as the start of the visit", () => {
		const lifecycle = createPageLoadLifecycle();

		lifecycle.start("page-1", 100, "navigation");
		lifecycle.beginRender("page-1", 450);

		expect(lifecycle.current()?.startedAt).toBe(100);
		expect(lifecycle.current()?.startSource).toBe("navigation");
	});

	it("moves a render fallback back to the direct navigation start", () => {
		const lifecycle = createPageLoadLifecycle();

		lifecycle.beginRender("page-1", 450);
		lifecycle.mark("page-editor-mounted", 475);
		lifecycle.start("page-1", 0, "direct");

		expect(lifecycle.current()?.startedAt).toBe(0);
		expect(lifecycle.current()?.startSource).toBe("direct");
		expect(lifecycle.current()?.marks.get("page-editor-mounted")).toBe(475);
	});

	it("does not restart a completed visit during a rerender", () => {
		const lifecycle = createPageLoadLifecycle();

		lifecycle.beginRender("page-1", 100);
		expect(lifecycle.complete("page-1")?.pageId).toBe("page-1");
		expect(lifecycle.beginRender("page-1", 500)).toBeNull();
		expect(lifecycle.current()).toBeNull();
	});

	it("allows a later navigation to measure the same page again", () => {
		const lifecycle = createPageLoadLifecycle();

		lifecycle.beginRender("page-1", 100);
		lifecycle.complete("page-1");
		lifecycle.start("page-1", 900, "navigation");

		expect(lifecycle.current()?.startedAt).toBe(900);
		expect(lifecycle.current()?.startSource).toBe("navigation");
	});

	it("does not let the outgoing page replace a pending navigation", () => {
		const lifecycle = createPageLoadLifecycle();

		lifecycle.start("page-2", 200, "navigation");
		lifecycle.beginRender("page-1", 250);

		expect(lifecycle.current()?.pageId).toBe("page-2");
	});
});

describe("page-load route parsing", () => {
	it("extracts page IDs only from page routes", () => {
		expect(pageIdFromPagePathname("/w/workspace/p/page-1")).toBe("page-1");
		expect(pageIdFromPagePathname("/w/workspace/p/page%202/")).toBe("page 2");
		expect(pageIdFromPagePathname("/w/workspace/home")).toBeNull();
		expect(pageIdFromPagePathname("/w/workspace/p/page-1/history")).toBeNull();
	});
});
