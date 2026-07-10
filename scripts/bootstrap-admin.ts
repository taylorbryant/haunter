import { parseArgs } from "node:util";
import { BootstrapAdminInputSchema } from "@/features/admin/schemas";

function fail(message: string): never {
	console.error(message);
	console.error("Usage: bun run bootstrap-admin --email owner@example.com");
	process.exit(1);
}

let email: string | undefined;
try {
	const parsed = parseArgs({
		args: Bun.argv.slice(2),
		options: { email: { type: "string", short: "e" } },
		strict: true,
		allowPositionals: false,
	});
	email = parsed.values.email;
} catch (error) {
	fail(error instanceof Error ? error.message : "Invalid arguments.");
}

const input = BootstrapAdminInputSchema.safeParse({ email });
if (!input.success) {
	fail("Provide a valid email address.");
}

const child = Bun.spawn(
	[
		"bun",
		"beignet",
		"task",
		"run",
		"admin.bootstrap",
		"--input",
		JSON.stringify(input.data),
	],
	{
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	},
);

process.exit(await child.exited);
