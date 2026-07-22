import { describe, expect, test } from "bun:test";
import { buildAuthAllowedHosts } from "./better-auth-hosts";

describe("Better Auth allowed hosts", () => {
	test("uses canonical deployer-owned URLs without duplicating a shared host", () => {
		expect(
			buildAuthAllowedHosts({
				appUrl: "http://localhost:3000",
				betterAuthUrl: "http://localhost:3000",
			}),
		).toEqual(["localhost:3000"]);
	});

	test("adds exact Vercel aliases and optional self-hosting patterns", () => {
		expect(
			buildAuthAllowedHosts({
				appUrl: "https://example.com",
				betterAuthUrl: "https://auth.example.com",
				vercelUrl: "example-abc123.vercel.app",
				vercelBranchUrl: "example-git-feature-team.vercel.app",
				vercelProjectProductionUrl: "example.com",
				additionalHosts: ["preview-*.example.net", "example.com", "  "],
			}),
		).toEqual([
			"example.com",
			"auth.example.com",
			"example-abc123.vercel.app",
			"example-git-feature-team.vercel.app",
			"preview-*.example.net",
		]);
	});
});
