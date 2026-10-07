import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("public MCP route accepts inline uploads and rejects oversized HTTP bodies", async () => {
	// Isolate the route's auth/server mocks from other tests in the same process.
	const child = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			fileURLToPath(new URL("./fixtures/mcp-http-limits.ts", import.meta.url)),
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, stdout, stderr }).toEqual({
		exitCode: 0,
		stdout: "",
		stderr: "",
	});
});
