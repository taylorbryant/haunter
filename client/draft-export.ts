import { pageExportFilename } from "@/features/pages/lib/export-filename";
import { blocksToMarkdown } from "@/features/pages/lib/markdown";
import type { BlockJson } from "@/features/pages/schemas";
import { draftRegistry, type RegisteredDraft } from "./draft-registry";

/** Read live controller values, including edits that IndexedDB could not store. */
export function createRecoveryDownload(entries: RegisteredDraft[]) {
	const pages = entries.filter(
		(entry) => entry.identity.resourceType === "page",
	);
	const titles = entries.filter(
		(entry) => entry.identity.resourceType === "page-title",
	);
	const canvases = entries.filter(
		(entry) => entry.identity.resourceType === "canvas",
	);
	const resources = pages.map((page) => ({
		type: "page",
		id: page.identity.resourceId,
		title: String(
			titles
				.find((title) => title.identity.resourceId === page.identity.resourceId)
				?.getSnapshot().value ?? "Recovered page",
		),
		content: page.getSnapshot().value as BlockJson[],
	}));
	for (const title of titles) {
		if (
			!pages.some(
				(page) => page.identity.resourceId === title.identity.resourceId,
			)
		) {
			resources.push({
				type: "page",
				id: title.identity.resourceId,
				title: String(title.getSnapshot().value),
				content: [],
			});
		}
	}
	const page = resources[0];
	if (page && resources.length === 1 && canvases.length === 0) {
		return {
			filename: pageExportFilename(page.title, "md"),
			mime: "text/markdown;charset=utf-8",
			content: `# ${page.title}\n\n${blocksToMarkdown(page.content)}`,
		};
	}
	// One file also preserves embedded canvases without depending on browser
	// permission for multiple automatic downloads. IDs link snapshots to blocks.
	return {
		filename: "haunter-draft-recovery.json",
		mime: "application/json",
		content: JSON.stringify(
			{
				format: "haunter-draft-recovery",
				version: 1,
				pages: resources,
				canvases: canvases.map((canvas) => ({
					id: canvas.identity.resourceId,
					snapshot: canvas.getSnapshot().value,
				})),
			},
			null,
			2,
		),
	};
}

export function downloadRecoveryDrafts(userId: string) {
	const file = createRecoveryDownload(draftRegistry.entries(userId));
	const url = URL.createObjectURL(
		new Blob([file.content], { type: file.mime }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = file.filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
