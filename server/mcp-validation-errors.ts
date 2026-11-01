import "@beignet/core/server-only";
import type {
	AgentCapabilityError,
	AgentCapabilitySchema,
} from "@beignet/core/agent-capabilities";
import { createZodSchemaConverter } from "@beignet/core/openapi";

type JsonSchema = Record<string, unknown>;
const converter = createZodSchemaConverter();
const fallback = "The tool arguments are invalid.";

function record(value: unknown): JsonSchema | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonSchema)
		: undefined;
}

function alternatives(schemas: JsonSchema[]) {
	const result: JsonSchema[] = [];
	const queue = [...schemas];
	while (queue.length && result.length < 64) {
		const schema = queue.shift()!;
		result.push(schema);
		for (const key of ["anyOf", "oneOf", "allOf"]) {
			const branches = schema[key];
			if (Array.isArray(branches)) {
				for (const branch of branches.slice(0, 16)) {
					const nested = record(branch);
					if (nested) queue.push(nested);
				}
			}
		}
	}
	return result;
}

function constraints(schemas: JsonSchema[]) {
	const hints = new Set<string>();
	for (const schema of schemas) {
		if (typeof schema.type === "string") hints.add(`type ${schema.type}`);
		if (typeof schema.format === "string") hints.add(`format ${schema.format}`);
		for (const [key, label] of [
			["minLength", "minimum length"],
			["maxLength", "maximum length"],
			["minItems", "minimum items"],
			["maxItems", "maximum items"],
			["minimum", "minimum"],
			["maximum", "maximum"],
			["exclusiveMinimum", "greater than"],
			["exclusiveMaximum", "less than"],
		] as const) {
			if (typeof schema[key] === "number" && Number.isFinite(schema[key]))
				hints.add(`${label} ${schema[key]}`);
		}
		const values = Array.isArray(schema.enum)
			? schema.enum
			: "const" in schema
				? [schema.const]
				: [];
		if (
			values.length &&
			values.length <= 8 &&
			values.every(
				(value) =>
					value === null ||
					typeof value === "boolean" ||
					typeof value === "number" ||
					(typeof value === "string" && value.length <= 60),
			)
		) {
			hints.add(
				`allowed values ${values.map((value) => JSON.stringify(value)).join(", ")}`,
			);
		}
	}
	return (
		[...hints].slice(0, 6).join("; ").slice(0, 360) ||
		"check the tool's input schema"
	);
}

/** Describe schema-owned fields and constraints, never raw issue messages or argument values. */
export function formatMcpValidationError(
	error: AgentCapabilityError,
	inputSchema: AgentCapabilitySchema | undefined,
): string {
	if (!inputSchema || !error.issues?.length) return fallback;
	try {
		const schema = converter.toJSONSchema(inputSchema, {
			io: "input",
			nameHint: `${error.capabilityName}.input`,
		});
		const details = new Set<string>();
		for (const issue of error.issues.slice(0, 8)) {
			let current = alternatives([schema]);
			let path = "";
			// Record keys and issue messages can contain submitted secrets. Only
			// expose path segments declared in the tool schema, plus array indices.
			for (const segment of (issue.path ?? []).slice(0, 8)) {
				const key = typeof segment === "object" ? segment.key : segment;
				const next: JsonSchema[] = [];
				if (typeof key === "string") {
					for (const candidate of current) {
						const properties = record(candidate.properties);
						if (!properties || !Object.hasOwn(properties, key)) continue;
						const child = record(properties[key]);
						if (child) next.push(child);
					}
				} else if (
					typeof key === "number" &&
					Number.isSafeInteger(key) &&
					key >= 0
				) {
					for (const candidate of current) {
						const child = record(
							Array.isArray(candidate.prefixItems)
								? candidate.prefixItems[key]
								: candidate.items,
						);
						if (child) next.push(child);
					}
				}
				if (!next.length) break;
				path +=
					typeof key === "number"
						? `[${key}]`
						: `${path ? "." : ""}${String(key)}`;
				current = alternatives(next);
			}
			details.add(`${path || "arguments"}: ${constraints(current)}.`);
		}
		return `${fallback} ${[...details].join(" ")}`.slice(0, 2_000);
	} catch {
		return fallback;
	}
}
