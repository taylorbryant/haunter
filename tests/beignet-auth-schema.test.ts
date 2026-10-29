import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectApp } from "@beignet/cli";

// Keep the pinned CLI patch honest at the Better Auth 1.7.3 schema boundary.
// Test both an installed version and the fallback used before dependencies exist.
test.each([
	{ declared: "1.7.0", installed: "1.7.0", requiresIssuer: true },
	{ declared: "^1.7.0", installed: "1.7.2", requiresIssuer: true },
	{ declared: "^1.7.0", installed: "1.7.3", requiresIssuer: false },
	{ declared: "^1.7.0", installed: "1.7.14", requiresIssuer: false },
	{ declared: "1.7.2", installed: undefined, requiresIssuer: true },
	{ declared: "^1.7.0", installed: undefined, requiresIssuer: true },
	{ declared: "1.7.14", installed: undefined, requiresIssuer: false },
	{ declared: "^1.7.3", installed: undefined, requiresIssuer: false },
])(
	"doctor handles $declared with installed $installed",
	async ({ declared, installed, requiresIssuer }) => {
		const directory = await mkdtemp(join(tmpdir(), "haunter-doctor-auth-"));
		try {
			await mkdir(join(directory, "lib"));
			for (const file of [
				"app-context.ts",
				"infra/port-wiring.ts",
				"ports/index.ts",
				"server/index.ts",
				"lib/use-case.ts",
			]) {
				await mkdir(dirname(join(directory, file)), { recursive: true });
				await writeFile(join(directory, file), "export {};\n");
			}
			await writeFile(
				join(directory, "package.json"),
				JSON.stringify({
					name: "auth-schema-fixture",
					dependencies: {
						"@beignet/provider-auth-better-auth": "0.0.58",
						"better-auth": declared,
					},
				}),
			);
			await writeFile(
				join(directory, "lib/better-auth.ts"),
				'import { drizzleAdapter } from "better-auth/adapters/drizzle";\nexport const database = drizzleAdapter({}, { provider: "sqlite" });\n',
			);
			if (installed) {
				await mkdir(join(directory, "node_modules/better-auth"), {
					recursive: true,
				});
				await writeFile(
					join(directory, "node_modules/better-auth/package.json"),
					JSON.stringify({ name: "better-auth", version: installed }),
				);
			}
			const result = await inspectApp({ cwd: directory, strict: true });
			expect(
				result.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "BEIGNET_BETTER_AUTH_ISSUER_SCHEMA_MISSING",
				),
			).toBe(requiresIssuer);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
