import "@beignet/core/server-only";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import * as Y from "yjs";
import type { CanvasSnapshot } from "@/features/canvases/schemas";
import {
	COLLAB_CONTENT_VERSION_KEY,
	COLLAB_SEEDED_KEY,
} from "@/features/pages/lib/collab-document";
import type { BlockJson, Page } from "@/features/pages/schemas";
import {
	type TaskBlockPatch,
	toCollaborativeTaskBlockProps,
} from "@/features/tasks/lib/patch-task-block";
import {
	activePageGeneration,
	CANVAS_META_NAME,
	CANVAS_RECORDS_NAME,
	PAGE_ACTIVE_GENERATION_KEY,
	PAGE_FRAGMENT_NAME,
	PAGE_META_NAME,
	PAGE_TASK_ATTRIBUTIONS_NAME,
	PAGE_TITLE_NAME,
	pageFragmentName,
	pageTaskAttributionsName,
	pageTitleName,
} from "./model";
import { serverPageSchema } from "./page-schema";
import { CANVAS_SEEDED_KEY } from "./seed-marker";
import { updateSharedText } from "./y-text";

const pageEditor = ServerBlockNoteEditor.create({ schema: serverPageSchema });

function findBlockContainer(
	root: Y.XmlFragment | Y.XmlElement,
	blockId: string,
): Y.XmlElement | null {
	for (const child of root.toArray()) {
		if (!(child instanceof Y.XmlElement)) continue;
		if (
			child.nodeName === "blockContainer" &&
			child.getAttribute("id") === blockId
		) {
			return child;
		}
		const nested = findBlockContainer(child, blockId);
		if (nested) return nested;
	}
	return null;
}

function pageBlockGroup(doc: Y.Doc): Y.XmlElement {
	const fragment = doc.getXmlFragment(
		pageFragmentName(activePageGeneration(doc)),
	);
	const current = fragment
		.toArray()
		.find(
			(child): child is Y.XmlElement =>
				child instanceof Y.XmlElement && child.nodeName === "blockGroup",
		);
	if (current) return current;
	const group = new Y.XmlElement("blockGroup");
	fragment.insert(0, [group]);
	return group;
}

export type PageProjection = { title: string; content: BlockJson[] };

export function pageToYDoc(
	page: Pick<Page, "title" | "content" | "contentUpdatedAt">,
): Y.Doc {
	const doc = pageEditor.blocksToYDoc(
		page.content as Parameters<typeof pageEditor.blocksToYDoc>[0],
		PAGE_FRAGMENT_NAME,
	);
	doc.transact(() => {
		doc.getText(PAGE_TITLE_NAME).insert(0, page.title);
		const meta = doc.getMap<string | boolean>(PAGE_META_NAME);
		meta.set(COLLAB_SEEDED_KEY, true);
		meta.set("titleSeeded", true);
		meta.set(COLLAB_CONTENT_VERSION_KEY, page.contentUpdatedAt);
	});
	return doc;
}

export function replacePageTitle(doc: Y.Doc, title: string): void {
	const sharedTitle = doc.getText(pageTitleName(activePageGeneration(doc)));
	doc.transact(() => {
		updateSharedText(sharedTitle, title);
		doc.getMap<string | boolean>(PAGE_META_NAME).set("titleSeeded", true);
	});
}

export function replacePageBlocks(doc: Y.Doc, blocks: BlockJson[]): void {
	pageEditor.blocksToYXmlFragment(
		blocks as Parameters<typeof pageEditor.blocksToYXmlFragment>[0],
		doc.getXmlFragment(pageFragmentName(activePageGeneration(doc))),
	);
}

function retireInactivePageRoots(doc: Y.Doc, activeGeneration: string): void {
	const activeFragment = pageFragmentName(activeGeneration);
	const activeTitle = pageTitleName(activeGeneration);
	const activeTaskAttributions = pageTaskAttributionsName(activeGeneration);
	for (const [name, root] of doc.share) {
		if (
			(root instanceof Y.XmlFragment &&
				(name === PAGE_FRAGMENT_NAME ||
					name.startsWith(`${PAGE_FRAGMENT_NAME}:`)) &&
				name !== activeFragment) ||
			(root instanceof Y.Text &&
				(name === PAGE_TITLE_NAME || name.startsWith(`${PAGE_TITLE_NAME}:`)) &&
				name !== activeTitle) ||
			(root instanceof Y.Map &&
				(name === PAGE_TASK_ATTRIBUTIONS_NAME ||
					name.startsWith(`${PAGE_TASK_ATTRIBUTIONS_NAME}:`)) &&
				name !== activeTaskAttributions)
		) {
			if (root instanceof Y.Map) root.clear();
			else if (root.length > 0) root.delete(0, root.length);
		}
	}
}

/** Replace a page through a new immutable generation. Switching the pointer is
 * one Yjs update, so concurrent writes to the prior generation cannot leak
 * into a restored/imported document. */
export function replacePageDocument(
	doc: Y.Doc,
	projection: PageProjection,
	generation: string,
): void {
	if (!generation) throw new Error("Page generations must not be empty");
	pageEditor.blocksToYXmlFragment(
		projection.content as Parameters<typeof pageEditor.blocksToYXmlFragment>[0],
		doc.getXmlFragment(pageFragmentName(generation)),
	);
	const title = doc.getText(pageTitleName(generation));
	doc.transact(() => {
		if (projection.title.length > 0) title.insert(0, projection.title);
		const meta = doc.getMap<string | boolean>(PAGE_META_NAME);
		meta.set(PAGE_ACTIVE_GENERATION_KEY, generation);
		meta.set(COLLAB_SEEDED_KEY, true);
		meta.set("titleSeeded", true);
		// Retired roots remain as empty fencing tombstones so delayed updates from
		// an old client can never become active again, but full historical page
		// payloads do not accumulate after every restore/import.
		retireInactivePageRoots(doc, generation);
	});
}

/** Append BlockNote blocks without rebuilding the existing fragment. This is
 * the server/MCP counterpart to a collaborative editor insertion: concurrent
 * edits to existing blocks remain independent Yjs operations. */
export function appendPageBlocks(doc: Y.Doc, blocks: BlockJson[]): number {
	if (blocks.length === 0) return 0;
	const source = pageEditor.blocksToYDoc(
		blocks as Parameters<typeof pageEditor.blocksToYDoc>[0],
		PAGE_FRAGMENT_NAME,
	);
	try {
		const sourceGroup = source
			.getXmlFragment(PAGE_FRAGMENT_NAME)
			.toArray()
			.find(
				(child): child is Y.XmlElement =>
					child instanceof Y.XmlElement && child.nodeName === "blockGroup",
			);
		const containers =
			sourceGroup
				?.toArray()
				.filter((child): child is Y.XmlElement => child instanceof Y.XmlElement)
				.map((child) => child.clone()) ?? [];
		if (containers.length === 0) return 0;
		doc.transact(() => {
			const target = pageBlockGroup(doc);
			target.insert(target.length, containers);
		});
		return containers.length;
	} finally {
		source.destroy();
	}
}

export function appendSubpageLink(
	doc: Y.Doc,
	child: Pick<Page, "id" | "workspaceId">,
): boolean {
	const fragment = doc.getXmlFragment(
		pageFragmentName(activePageGeneration(doc)),
	);
	if (findBlockContainer(fragment, child.id)) return false;
	doc.transact(() => {
		const container = new Y.XmlElement("blockContainer");
		container.setAttribute("id", child.id);
		const pageLink = new Y.XmlElement("pageLink");
		pageLink.setAttribute("pageId", child.id);
		pageLink.setAttribute("workspaceId", child.workspaceId);
		container.insert(0, [pageLink]);
		const group = pageBlockGroup(doc);
		group.insert(group.length, [container]);
	});
	return true;
}

export function patchPageTaskBlock(
	doc: Y.Doc,
	blockId: string,
	patch: TaskBlockPatch,
): boolean {
	const container = findBlockContainer(
		doc.getXmlFragment(pageFragmentName(activePageGeneration(doc))),
		blockId,
	);
	const task = container
		?.toArray()
		.find(
			(child): child is Y.XmlElement =>
				child instanceof Y.XmlElement && child.nodeName === "task",
		);
	if (!task) return false;
	doc.transact(() => {
		for (const [name, value] of Object.entries(
			toCollaborativeTaskBlockProps(patch),
		)) {
			task.setAttribute(name, value as never);
		}
	});
	return true;
}

export function pageProjectionFromYDoc(doc: Y.Doc): PageProjection {
	const generation = activePageGeneration(doc);
	return {
		title: doc.getText(pageTitleName(generation)).toString(),
		content: pageEditor.yDocToBlocks(
			doc,
			pageFragmentName(generation),
		) as BlockJson[],
	};
}

export function canvasToYDoc(snapshot: CanvasSnapshot): Y.Doc {
	const doc = new Y.Doc();
	const records = doc.getMap<unknown>(CANVAS_RECORDS_NAME);
	const meta = doc.getMap<unknown>(CANVAS_META_NAME);
	const store = snapshot.store;
	doc.transact(() => {
		if (store && typeof store === "object") {
			for (const [id, record] of Object.entries(store)) records.set(id, record);
		}
		if (snapshot.schema && typeof snapshot.schema === "object") {
			meta.set("schema", snapshot.schema);
		}
		meta.set(CANVAS_SEEDED_KEY, true);
	});
	return doc;
}

export function canvasProjectionFromYDoc(doc: Y.Doc): CanvasSnapshot {
	const records = doc.getMap<unknown>(CANVAS_RECORDS_NAME);
	const meta = doc.getMap<unknown>(CANVAS_META_NAME);
	const schema = meta.get("schema");
	if (!schema || typeof schema !== "object") return {};
	return {
		schema,
		store: Object.fromEntries(records.entries()),
	};
}

export function replaceCanvasSnapshot(
	doc: Y.Doc,
	snapshot: CanvasSnapshot,
): void {
	const records = doc.getMap<unknown>(CANVAS_RECORDS_NAME);
	const meta = doc.getMap<unknown>(CANVAS_META_NAME);
	doc.transact(() => {
		for (const id of [...records.keys()]) records.delete(id);
		const store = snapshot.store;
		if (store && typeof store === "object") {
			for (const [id, record] of Object.entries(store)) records.set(id, record);
		}
		if (snapshot.schema && typeof snapshot.schema === "object") {
			meta.set("schema", snapshot.schema);
		} else {
			meta.delete("schema");
		}
		meta.set(CANVAS_SEEDED_KEY, true);
	});
}

export function documentStateVector(doc: Y.Doc): Uint8Array {
	return Y.encodeStateVector(doc);
}

export function documentUpdate(doc: Y.Doc): Uint8Array {
	return Y.encodeStateAsUpdate(doc);
}

export function yDocFromUpdate(update: Uint8Array): Y.Doc {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, update);
	return doc;
}
