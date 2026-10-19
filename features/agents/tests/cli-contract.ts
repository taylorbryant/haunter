import { isDeepStrictEqual } from "node:util";

type Schema = Record<string, unknown>;
export type ToolContract = {
	name: string;
	inputSchema: Schema;
	outputSchema?: Schema;
};

// A deliberately conservative review guard, not a general JSON Schema subtype
// solver. Allow additive properties/tools and compatible required-field changes;
// flag other constraint/default/dialect changes for explicit compatibility review.
export function contractChanges(
	baseline: ToolContract[],
	current: ToolContract[],
) {
	const changes: string[] = [];
	for (const old of baseline) {
		const tool = current.find((candidate) => candidate.name === old.name);
		if (!tool) {
			changes.push(`${old.name}: removed tool`);
			continue;
		}
		compare(old.inputSchema, tool.inputSchema, "input", `${old.name}.input`);
		if (old.outputSchema)
			compare(
				old.outputSchema,
				tool.outputSchema,
				"output",
				`${old.name}.output`,
			);
	}
	return changes;

	function compare(
		old: unknown,
		next: unknown,
		direction: "input" | "output",
		path: string,
	) {
		if (!record(old) || !record(next)) {
			if (!isDeepStrictEqual(old, next))
				changes.push(`${path}: changed schema`);
			return;
		}
		const oldRequired = (old.required ?? []) as string[];
		const nextRequired = (next.required ?? []) as string[];
		const missing =
			direction === "input"
				? nextRequired.filter((key) => !oldRequired.includes(key))
				: oldRequired.filter((key) => !nextRequired.includes(key));
		if (missing.length)
			changes.push(
				`${path}.required: ${direction === "input" ? "new required arguments" : "no longer guaranteed"}: ${missing.join(", ")}`,
			);
		const oldProperties = record(old.properties) ? old.properties : {};
		const nextProperties = record(next.properties) ? next.properties : {};
		for (const [key, value] of Object.entries(oldProperties)) {
			if (!Object.hasOwn(nextProperties, key))
				changes.push(`${path}.${key}: removed property`);
			else compare(value, nextProperties[key], direction, `${path}.${key}`);
		}
		for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
			if (
				[
					"properties",
					"required",
					"title",
					"description",
					"examples",
					"$comment",
				].includes(key)
			)
				continue;
			if (key === "items")
				compare(old[key], next[key], direction, `${path}.items`);
			else if (
				["anyOf", "oneOf", "allOf"].includes(key) &&
				Array.isArray(old[key]) &&
				Array.isArray(next[key]) &&
				old[key].length === next[key].length
			) {
				old[key].forEach((item, i) =>
					compare(
						item,
						(next[key] as unknown[])[i],
						direction,
						`${path}.${key}[${i}]`,
					),
				);
			} else if (!isDeepStrictEqual(old[key], next[key]))
				changes.push(`${path}.${key}: changed constraint or default`);
		}
	}
}

function record(value: unknown): value is Schema {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
