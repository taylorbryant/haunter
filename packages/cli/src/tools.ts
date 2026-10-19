import { createReadStream } from "node:fs";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { CliIO } from "./cli";

export async function readToolInput(file: string | undefined, io: CliIO) {
	if (!file) return {};
	if (file === "-" && io.isTTY)
		throw new Error("Pipe a JSON object into tools call --input -.");
	const stream = file === "-" ? io.stdin : createReadStream(file);
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of stream) {
		io.signal?.throwIfAborted();
		const buffer = Buffer.from(chunk);
		bytes += buffer.length;
		if (bytes > 1_000_000)
			throw new Error("Tool input exceeds 1,000,000 bytes.");
		chunks.push(buffer);
	}
	let input: unknown;
	try {
		input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("Tool input must be valid JSON.");
	}
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Tool input must be a JSON object.");
	return input as Record<string, unknown>;
}

export function isCliTool(tool: Tool) {
	const ui = tool._meta?.ui;
	if (!ui || typeof ui !== "object") return true;
	const visibility = (ui as { visibility?: unknown }).visibility;
	return !Array.isArray(visibility) || visibility.includes("model");
}

export function toolValidator(schema: Tool["inputSchema"], name: string) {
	try {
		// Supports the server's JSON Schema 2020-12 dialect without coercion,
		// defaults, code generation, or fetching external references.
		return new CfWorkerJsonSchemaValidator().getValidator(
			schema as JsonSchemaType,
		);
	} catch {
		throw new Error(
			`Cannot validate the schema for ${name}. Update the CLI and try again.`,
		);
	}
}
