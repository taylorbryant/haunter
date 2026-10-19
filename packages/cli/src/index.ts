#!/usr/bin/env node
import { runCli } from "./cli";

const controller = new AbortController();
let brokenPipe = false;
const cancel = () => {
	controller.abort();
	process.stdin.destroy();
};
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code === "EPIPE") {
		brokenPipe = true;
		controller.abort();
		process.exitCode = 0;
	} else throw error;
});
process.exitCode = await runCli(process.argv.slice(2), {
	stdout: (text) => {
		process.stdout.write(text);
	},
	stderr: (text) => {
		process.stderr.write(text);
	},
	stdin: process.stdin,
	isTTY: Boolean(process.stdin.isTTY),
	env: process.env,
	signal: controller.signal,
});
process.removeListener("SIGINT", cancel);
process.removeListener("SIGTERM", cancel);
if (brokenPipe) process.exitCode = 0;
