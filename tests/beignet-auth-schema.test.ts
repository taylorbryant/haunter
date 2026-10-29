import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectApp } from "@beignet/cli";

// Doctor should catch a return of the legacy issuer constraint that broke
// Better Auth writes, while accepting the migrated account schema.
test.each([
	{ issuer: 'text("issuer").notNull()', installed: true, obsolete: true },
	{ issuer: 'text("issuer")', installed: true, obsolete: false },
	{ issuer: undefined, installed: true, obsolete: false },
	{
		issuer: 'text("issuer").notNull().default("legacy")',
		installed: true,
		obsolete: false,
	},
	{ issuer: 'text("issuer").notNull()', installed: false, obsolete: true },
	{ issuer: 'text("issuer")', installed: false, obsolete: false },
])(
	"doctor checks issuer $issuer with dependencies installed: $installed",
	async ({ issuer, installed, obsolete }) => {
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
						"@beignet/provider-auth-better-auth": "0.0.59",
						"better-auth": "1.7.14",
					},
				}),
			);
			await writeFile(
				join(directory, "lib/better-auth.ts"),
				'import { drizzleAdapter } from "better-auth/adapters/drizzle";\nexport const database = drizzleAdapter({}, { provider: "sqlite" });\n',
			);
			await mkdir(join(directory, "infra/db/schema"), { recursive: true });
			await writeFile(
				join(directory, "infra/db/schema/index.ts"),
				`import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  ${issuer ? `issuer: ${issuer},` : ""}
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
});\n`,
			);
			if (installed) {
				await mkdir(join(directory, "node_modules/better-auth"), {
					recursive: true,
				});
				await writeFile(
					join(directory, "node_modules/better-auth/package.json"),
					JSON.stringify({ name: "better-auth", version: "1.7.14" }),
				);
			}
			const result = await inspectApp({ cwd: directory, strict: true });
			expect(
				result.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "BEIGNET_BETTER_AUTH_ISSUER_SCHEMA_OBSOLETE",
				),
			).toBe(obsolete);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
