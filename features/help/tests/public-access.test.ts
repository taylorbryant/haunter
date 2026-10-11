import { expect, test } from "bun:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import { HELP_GUIDES } from "../guides";

test("guides index and every guide bypass the session proxy", () => {
	for (const path of [
		"/guides",
		"/guides/",
		...HELP_GUIDES.map(({ slug }) => `/guides/${slug}`),
	]) {
		expect(
			unstable_doesMiddlewareMatch({
				config,
				url: `https://haunter.test${path}`,
			}),
		).toBe(false);
	}
});

test("the guides exception does not bypass protection for other app paths", () => {
	for (const path of [
		"/",
		"/help",
		"/help/pages",
		"/helpful",
		"/help-admin",
		"/guides-admin",
		"/guides-private",
		"/w/example/home",
		"/w/example/p/123",
	]) {
		expect(
			unstable_doesMiddlewareMatch({
				config,
				url: `https://haunter.test${path}`,
			}),
		).toBe(true);
	}
});
