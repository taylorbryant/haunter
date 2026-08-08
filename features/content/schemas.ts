import { z } from "zod";

/**
 * Structural representation of a persisted BlockNote block. Block-specific
 * semantics remain owned by the feature that understands the block type.
 */
export type BlockJson = {
	id: string;
	type: string;
	props: Record<string, unknown>;
	content?: unknown;
	children: BlockJson[];
};

export const BlockJsonSchema: z.ZodType<BlockJson> = z.lazy(() =>
	z.object({
		id: z.string(),
		type: z.string(),
		props: z.record(z.string(), z.unknown()).default({}),
		content: z.unknown().optional(),
		children: z.array(BlockJsonSchema).default([]),
	}),
);

export const DocumentContentSchema = z.array(BlockJsonSchema);
