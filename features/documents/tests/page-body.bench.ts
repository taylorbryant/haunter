import { validateDocumentUpdate } from "@/infra/documents/validate-update";
import { seedFixtureBody } from "@/features/documents/tests/helpers";
/** Run explicitly with `bun run benchmark:documents`; never touches the configured database. */
import { performance } from "node:perf_hooks";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { projectPageBody } from "@/infra/documents/codec";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import { PageContentSchema, type BlockJson } from "@/features/pages/schemas";
import { documentFixture, firstText, paragraph } from "./helpers";

const samples = 9;
const fixtureDirectory = Bun.argv.includes("--fixtures")
	? await mkdtemp(join(tmpdir(), "haunter-document-benchmarks-"))
	: undefined;
function summary(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b);
	return {
		samples: values.length,
		median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
		max: Math.round((sorted.at(-1) ?? 0) * 100) / 100,
	};
}
function fixtureBlocks(count: number): BlockJson[] {
	return Array.from({ length: count }, (_, index) =>
		index % 10 === 9
			? {
					id: crypto.randomUUID(),
					type: "codeBlock",
					props: { language: "typescript" },
					content: [
						{
							type: "text",
							text: "  const value = 42;\n\n".repeat(8),
							styles: {},
						},
					],
					children: [],
				}
			: paragraph(
					`Paragraph ${index}. ${"Representative editor text with punctuation and Unicode: café 日本語. ".repeat(6)}`,
				),
	);
}

const results = [];
for (const blocks of [100, 1000, 3000]) {
	const f = await documentFixture();
	const timings: Record<string, number[]> = {};
	const measure = async <T>(name: string, run: () => T | Promise<T>) => {
		const start = performance.now();
		const value = await run();
		timings[name] ??= [];
		timings[name].push(performance.now() - start);
		return value;
	};
	const content = fixtureBlocks(blocks);
	if (fixtureDirectory)
		await Bun.write(
			join(fixtureDirectory, `${blocks}-blocks.json`),
			JSON.stringify(content),
		);
	await seedFixtureBody(f, JSON.parse(JSON.stringify(content)));
	const stored = await measure("initialBinaryLoadMs", () =>
		loadPageBody(f.ctx, f.workspaceId, f.page.id),
	);
	const doc = new Y.Doc();
	Y.applyUpdate(doc, stored.state);
	let revision = stored.revision;
	try {
		for (let i = 0; i < samples; i++) {
			await measure("sqlBodyReadAndSerializeMs", async () =>
				JSON.stringify(
					await f.database.repositories.pages.findById(f.scope, f.page.id),
				),
			);
			await measure("sqlMetadataReadAndSerializeMs", async () =>
				JSON.stringify(
					await f.database.repositories.pages.findMetaById(f.scope, f.page.id),
				),
			);
			await measure("binaryLoadMs", async () => {
				await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			});
			await measure("binaryApplyMs", () => {
				const loaded = new Y.Doc();
				Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc));
				loaded.destroy();
			});
			await measure("projectValidateSerializeMs", () =>
				JSON.stringify(PageContentSchema.parse(projectPageBody(doc))),
			);
			const beforeEdit = Y.encodeStateVector(doc);
			await measure("editMs", () => firstText(doc).insert(0, "x"));
			const update = Y.encodeStateAsUpdate(doc, beforeEdit);
			await measure("validateIncomingUpdateMs", () =>
				validateDocumentUpdate(doc, update),
			);
			const saved = await measure("persistLocalSqliteMs", () =>
				persistPageBody(f.ctx, {
					workspaceId: f.workspaceId,
					pageId: f.page.id,
					baseRevision: revision,
					generation: 0,
					doc,
				}),
			);
			revision = saved.revision;
		}
		const page = await f.database.repositories.pages.findById(
			f.scope,
			f.page.id,
		);
		const meta = await f.database.repositories.pages.findMetaById(
			f.scope,
			f.page.id,
		);
		const vector = Y.encodeStateVector(doc);
		firstText(doc).insert(0, "x");
		if (Bun.argv.includes("--sync")) {
			const { benchmarkSync } = await import("./sync-benchmark");
			await benchmarkSync(f, samples, measure);
		}
		results.push({
			blocks,
			bytes: {
				fullPageJson: Buffer.byteLength(JSON.stringify(page)),
				metadataJson: Buffer.byteLength(JSON.stringify(meta)),
				binarySnapshot: Y.encodeStateAsUpdate(doc).byteLength,
				oneCharacterUpdate: Y.encodeStateAsUpdate(doc, vector).byteLength,
				projectedBody: Buffer.byteLength(JSON.stringify(page?.content)),
			},
			timings: Object.fromEntries(
				Object.entries(timings).map(([key, values]) => [key, summary(values)]),
			),
		});
	} finally {
		doc.destroy();
		await f.database.close();
	}
}
// Module initialization and fixture creation are outside timing.
console.log(
	JSON.stringify(
		{
			runtime: `Bun ${Bun.version}`,
			samples,
			database: "temporary local SQLite",
			fixtureDirectory,
			results,
		},
		null,
		2,
	),
);
