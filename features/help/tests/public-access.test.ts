import { expect, test } from "bun:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import { HELP_GUIDES } from "../guides";

test("Help index and every guide bypass the session proxy", () => {
	for (const path of [
		"/help",
		"/help/",
		...HELP_GUIDES.map(({ slug }) => `/help/${slug}`),
	]) {
		expect(
			unstable_doesMiddlewareMatch({
				config,
				url: `https://haunter.test${path}`,
			}),
		).toBe(false);
	}
});

test("the Help exception does not bypass protection for other app paths", () => {
	for (const path of [
		"/",
		"/helpful",
		"/help-admin",
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
