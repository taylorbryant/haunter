import { prepareCanvases, applyPreparedCanvases } from "./canvas-migration";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { DOCUMENT_SCHEMA_VERSION } from "@/features/documents/model";
import type { DocumentMaintenancePort } from "@/features/documents/ports";
import { normalizeCodeBlockLanguages } from "@/features/pages/lib/code-block-language";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { PageContentSchema } from "@/features/pages/schemas";
import * as schema from "@/infra/db/schema";
import type { BlockJson } from "@/features/pages/schemas";
import { projectPageBody, seedPageBody } from "./codec";

// Older heading JSON stored a disabled toggle flag which the current schema omits.
// True is deliberately retained so unsupported toggle headings fail preflight.
function migrationSource(blocks: BlockJson[]): BlockJson[] {
	return normalizeCodeBlockLanguages(blocks).map((block) => {
		const props = { ...block.props };
		if (block.type === "heading" && props.isToggleable === false)
			delete props.isToggleable;
		return {
			...block,
			props,
			...(block.children ? { children: migrationSource(block.children) } : {}),
		};
	});
}

/** Explicit source values must survive. The editor may add default props. */
function preservesSource(source: unknown, projected: unknown): boolean {
	if (Array.isArray(source)) {
		return (
			Array.isArray(projected) &&
			source.length === projected.length &&
			source.every((value, index) => preservesSource(value, projected[index]))
		);
	}
	if (source !== null && typeof source === "object") {
		return (
			projected !== null &&
			typeof projected === "object" &&
			Object.entries(source).every(([key, value]) =>
				preservesSource(value, (projected as Record<string, unknown>)[key]),
			)
		);
	}
	return source === projected;
}

export function createDocumentMaintenance(
	db: DrizzleSqliteDatabase<typeof schema>,
	databaseUrl: string,
): DocumentMaintenancePort {
	const database = databaseUrl.startsWith("file:")
		? databaseUrl
		: new URL(databaseUrl).hostname;
	return {
		async migrate(input) {
			if (
				!input.dryRun &&
				(input.expectedDatabase !== database ||
					!input.backupPath ||
					!isAbsolute(input.backupPath))
			) {
				throw new Error(
					"Apply requires expectedDatabase matching the target and an absolute, new backupPath. Stop all app and worker writers first.",
				);
			}
			const canvasMigration = await prepareCanvases(db);
			const { pages, documents } = await db.transaction(async (tx) => ({
				pages: await tx.select().from(schema.pages),
				documents: await tx.select().from(schema.collaborativeDocuments),
			}));
			const byPage = new Map(documents.map((row) => [row.pageId, row]));
			const prepared = [];
			const errors: string[] = [];
			for (const page of pages) {
				let doc: Y.Doc | undefined;
				try {
					const content = migrationSource(
						PageContentSchema.parse(JSON.parse(page.content)),
					);
					const existing = byPage.get(page.id);
					if (existing) {
						if (
							existing.schemaVersion !== DOCUMENT_SCHEMA_VERSION ||
							existing.workspaceId !== page.workspaceId
						)
							throw new Error("Unsupported schema or workspace mismatch");
						doc = new Y.Doc();
						Y.applyUpdate(doc, new Uint8Array(existing.state));
					} else doc = seedPageBody(content);
					const projected = PageContentSchema.parse(
						JSON.parse(JSON.stringify(projectPageBody(doc))),
					);
					// Empty legacy pages acquire the editor's single empty paragraph.
					const emptyPlaceholder =
						content.length === 0 &&
						projected.length === 1 &&
						projected[0]?.type === "paragraph" &&
						Array.isArray(projected[0].content) &&
						projected[0].content.length === 0 &&
						!projected[0].children?.length;
					if (!emptyPlaceholder && !preservesSource(content, projected))
						throw new Error(
							"Conversion loses source data or the SQL projection differs from Yjs",
						);
					const state = Buffer.from(Y.encodeStateAsUpdate(doc));
					if (state.length > 8 * 1024 * 1024)
						throw new Error("Document exceeds the 8 MiB limit");
					const contentJson = JSON.stringify(projected);
					if (!existing || page.content !== contentJson)
						prepared.push({
							page,
							existing,
							state,
							content: contentJson,
							searchText: extractPageSearchText(projected),
						});
				} catch {
					// Never log document text, including schema-parser exception details.
					errors.push(page.id);
				} finally {
					doc?.destroy();
				}
			}
			if (
				documents.some((row) => !pages.some((page) => page.id === row.pageId))
			)
				throw new Error(
					"Orphan collaborative documents found; no changes made",
				);
			if (errors.length)
				throw new Error(
					`Migration preflight failed for ${errors.length} page(s): ${errors.join(", ")}. No changes made.`,
				);
			const report = {
				database,
				pages: pages.length,
				canvases: canvasMigration.canvases.length,
				canvasesConverted: canvasMigration.prepared.length,
				converted: pages.length - documents.length,
				projectionsUpdated: prepared.filter((row) => row.existing).length,
				existing: documents.length,
				trashed: pages.filter((page) => page.deletedAt !== null).length,
				dryRun: input.dryRun,
			};
			if (input.dryRun) return report;
			// Exclusive creation prevents accidentally replacing the pre-cutover backup.
			const backup = await open(input.backupPath!, "wx", 0o600);
			try {
				await backup.writeFile(
					JSON.stringify({
						format: "haunter-document-cutover-v1",
						database,
						createdAt: new Date().toISOString(),
						pages,
						canvases: canvasMigration.canvases,
						canvasRooms: canvasMigration.documents,
						documents: documents.map((row) => ({
							...row,
							state: Buffer.from(row.state).toString("base64"),
						})),
					}),
				);
				await backup.sync();
			} finally {
				await backup.close();
			}
			for (const candidate of prepared) {
				await db.transaction(async (tx) => {
					const [current] = await tx
						.select()
						.from(schema.pages)
						.where(eq(schema.pages.id, candidate.page.id));
					if (
						!current ||
						current.content !== candidate.page.content ||
						current.contentUpdatedAt !== candidate.page.contentUpdatedAt
					)
						throw new Error(
							`Page ${candidate.page.id} changed during migration. Stop writers and rerun preflight.`,
						);
					if (candidate.existing) {
						const [document] = await tx
							.select()
							.from(schema.collaborativeDocuments)
							.where(eq(schema.collaborativeDocuments.pageId, current.id));
						if (
							!document ||
							document.revision !== candidate.existing.revision ||
							document.generation !== candidate.existing.generation ||
							!Buffer.from(document.state).equals(
								Buffer.from(candidate.existing.state),
							)
						)
							throw new Error(
								`Page ${current.id} changed during migration. Stop writers and rerun preflight.`,
							);
					} else
						await tx.insert(schema.collaborativeDocuments).values({
							pageId: current.id,
							workspaceId: current.workspaceId,
							state: candidate.state,
							schemaVersion: DOCUMENT_SCHEMA_VERSION,
							revision: 0,
							generation: 0,
							updatedAt: current.contentUpdatedAt,
						});
					await tx
						.update(schema.pages)
						.set({
							content: candidate.content,
							searchText: candidate.searchText,
						})
						.where(eq(schema.pages.id, current.id));
				});
			}
			await applyPreparedCanvases(db, canvasMigration.prepared);
			return { ...report, backupPath: input.backupPath };
		},
	};
}
