import { expect, test } from "bun:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

test("the homepage and its screenshots are public, including campaign links", () => {
	for (const path of [
		"/",
		"/?utm_source=launch",
		"/guides/images/workspace.webp",
		"/guides/images/tasks.webp",
		"/guides/images/inline-canvas.webp",
	]) {
		expect(
			unstable_doesMiddlewareMatch({
				config,
				url: `https://haunter.test${path}`,
			}),
		).toBe(false);
	}
});

test("making the homepage public preserves the workspace authentication gate", () => {
	for (const path of [
		"/app",
		"/app?from=homepage",
		"/w/studio/home",
		"/w/studio/p/notes",
		"/device/capabilities",
		"/waitlist",
	]) {
		expect(
			unstable_doesMiddlewareMatch({
				config,
				url: `https://haunter.test${path}`,
			}),
		).toBe(true);
		const response = proxy(new NextRequest(`https://haunter.test${path}`));
		const location = new URL(response.headers.get("location") ?? "");
		expect(response.status).toBe(307);
		expect(location.pathname).toBe("/sign-in");
		expect(location.searchParams.get("next")).toBe(path);
	}
});
