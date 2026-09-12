import { z } from "zod";
import { CanvasSnapshotSchema } from "@/features/canvases/schemas";
import {
	CreatePageInputSchema,
	PAGE_TITLE_MAX_LENGTH,
} from "@/features/pages/schemas";

export const MAX_RECOVERY_FILE_BYTES = 5_000_000;
const contentSchema = CreatePageInputSchema.shape.initialContent.unwrap();
const stateSchema = z.object({
	format: z.literal("haunter-yjs-v1"),
	update: z.union([
		z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000),
		z
			.string()
			.min(4)
			.max(2_666_668)
			.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
			.transform((value) =>
				Array.from(atob(value), (character) => character.charCodeAt(0)),
			)
			.pipe(z.array(z.number()).max(2_000_000)),
	]),
});
const pageSchema = z.object({
	id: z.string().min(1).max(300),
	title: z.string().max(PAGE_TITLE_MAX_LENGTH).default("Recovered page"),
	content: contentSchema.default([]),
	collaborativeState: stateSchema.optional(),
});
const bundleSchema = z
	.object({
		format: z.literal("haunter-draft-recovery"),
		version: z.literal(1),
		pages: z.array(pageSchema).max(20),
		canvases: z
			.array(
				z
					.object({
						id: z.string().min(1).max(300),
						snapshot: CanvasSnapshotSchema.optional(),
						collaborativeState: stateSchema.optional(),
					})
					.refine(
						(canvas) =>
							canvas.snapshot !== undefined ||
							canvas.collaborativeState !== undefined,
						"Canvas recovery needs a snapshot or binary state",
					),
			)
			.max(20)
			.default([]),
	})
	.refine(
		(bundle) => bundle.pages.length + bundle.canvases.length > 0,
		"The file has no drafts to recover.",
	)
	.refine(
		(bundle) =>
			new Set(bundle.pages.map((page) => page.id)).size ===
				bundle.pages.length &&
			new Set(bundle.canvases.map((canvas) => canvas.id)).size ===
				bundle.canvases.length,
		"The recovery file contains duplicate resource IDs.",
	);

export function parseRecoveryFile(
	file: string,
	filename = "Recovered page.json",
) {
	if (new TextEncoder().encode(file).length > MAX_RECOVERY_FILE_BYTES)
		throw new Error("Recovery files must be 5 MB or smaller.");
	let value: unknown;
	try {
		value = JSON.parse(file);
	} catch {
		throw new Error(
			"Choose a Haunter JSON recovery file. Markdown drafts can be imported with Import Markdown.",
		);
	}
	const title = filename
		.replace(/\.json$/i, "")
		.slice(0, PAGE_TITLE_MAX_LENGTH);
	// The previous editor exported bare block arrays. Standalone binary exports
	// are also accepted, but imported CRDT identities are never attached to a live page.
	if (Array.isArray(value))
		value = {
			format: "haunter-draft-recovery",
			version: 1,
			pages: [{ id: "draft", title, content: value }],
		};
	else if (
		value &&
		typeof value === "object" &&
		"format" in value &&
		value.format === "haunter-yjs-v1"
	)
		value = {
			format: "haunter-draft-recovery",
			version: 1,
			pages: [{ id: "draft", title, collaborativeState: value }],
		};
	const result = bundleSchema.safeParse(value);
	if (!result.success)
		throw new Error(
			"This is not a supported Haunter recovery file, or it exceeds the content limits.",
		);
	return result.data;
}

export const ImportRecoveryInputSchema = z.object({
	workspaceId: z.string().min(1),
	filename: z.string().max(300),
	file: z.string().max(MAX_RECOVERY_FILE_BYTES),
});
export const ImportRecoveryOutputSchema = z.object({
	pages: z.array(z.object({ id: z.uuid(), title: z.string() })),
	canvasIds: z.array(z.uuid()),
});
