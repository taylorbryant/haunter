import { expect, test } from "bun:test";
import { AgentCapabilityError } from "@beignet/core/agent-capabilities";
import { z } from "zod";
import { formatMcpValidationError } from "@/server/mcp-validation-errors";

test("MCP input errors report nested schema paths and constraints without argument values", () => {
	const schema = z.object({
		operations: z.array(
			z.object({ pageId: z.uuid(), title: z.string().min(1).max(20) }),
		),
		mode: z.enum(["view", "edit"]),
	});
	const parsed = schema.safeParse({
		operations: [{ pageId: "private-token", title: "" }],
		mode: "private-mode",
	});
	if (parsed.success) throw new Error("Expected invalid fixture");
	const result = formatMcpValidationError(
		new AgentCapabilityError({
			code: "invalid_input",
			capabilityName: "test",
			message: "private-error",
			issues: parsed.error.issues,
		}),
		schema,
	);
	expect(result).toContain("operations[0].pageId: type string; format uuid");
	expect(result).toContain(
		"operations[0].title: type string; minimum length 1; maximum length 20",
	);
	expect(result).toContain('allowed values "view", "edit"');
	expect(result).not.toContain("private");
});

test("MCP input errors do not echo custom issue messages or dynamic record keys", () => {
	const schema = z.object({ properties: z.record(z.string(), z.number()) });
	const result = formatMcpValidationError(
		new AgentCapabilityError({
			code: "invalid_input",
			capabilityName: "test",
			message: "private-error",
			issues: [
				{ path: ["properties", "secret-record-key"], message: "secret-value" },
				{ path: ["secret-root-key"], message: "secret-message" },
			],
		}),
		schema,
	);
	expect(result).toContain("properties: type object");
	expect(result).not.toContain("secret");
});

test("MCP input error output is bounded even with many nested issues", () => {
	const schema = z.object({ title: z.string().min(1) });
	const result = formatMcpValidationError(
		new AgentCapabilityError({
			code: "invalid_input",
			capabilityName: "test",
			message: "private-error",
			issues: Array.from({ length: 1_000 }, () => ({
				path: ["title"],
				message: "secret".repeat(1_000),
			})),
		}),
		schema,
	);
	expect(result.length).toBeLessThanOrEqual(2_000);
	expect(result).toContain("title: type string; minimum length 1");
	expect(result).not.toContain("secret");
});
