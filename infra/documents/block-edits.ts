import { isDeepStrictEqual } from "node:util";
import type { PropSchema } from "@blocknote/core";
import * as Y from "yjs";
import type { BlockJson } from "@/features/content/schemas";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";
import {
	EditableBlockTypeSchema,
	EditableInlineSchema,
	type PageBlockOperation,
} from "@/features/pages/block-editing";
import { CreatePageInputSchema } from "@/features/pages/schemas";
import { appError } from "@/features/shared/errors";
import { seedPageBody, projectPageBody } from "./codec";
import { updateInlineContent } from "./inline-edits";
import { serverPageSchema } from "./page-schema";
import { recordBlockMove } from "./move-conflicts";

function invalid(message: string): never {
	throw appError("InvalidPageContent", { message });
}

function validateEditableBlock(block: BlockJson) {
	if (!EditableBlockTypeSchema.safeParse(block.type).success)
		invalid(
			`Editing ${block.type} blocks is not supported. Leave that block unchanged.`,
		);
	const spec =
		serverPageSchema.blockSchema[
			block.type as keyof typeof serverPageSchema.blockSchema
		];
	const props: PropSchema = spec.propSchema;
	for (const [key, value] of Object.entries(block.props)) {
		const property = Object.hasOwn(props, key) ? props[key] : undefined;
		if (
			!property ||
			typeof value !==
				("type" in property ? property.type : typeof property.default) ||
			(typeof value === "number" && !Number.isFinite(value)) ||
			(property.values && !property.values.some((allowed) => allowed === value))
		)
			invalid(`Invalid ${block.type} property: ${key}.`);
	}
	if (spec.content === "inline" || spec.content === "plain") {
		const content = EditableInlineSchema.safeParse(block.content ?? []);
		if (!content.success) invalid(`Invalid inline content for ${block.type}.`);
		if (
			spec.content === "plain" &&
			content.data.some(
				(part) => part.type !== "text" || Object.keys(part.styles).length > 0,
			)
		)
			invalid(`${block.type} blocks accept only unstyled plain text.`);
	} else if (block.content !== undefined) {
		invalid(`${block.type} blocks do not accept inline content.`);
	}
}

/** Bound and validate before codec conversion, which can otherwise drop unknown fields. */
export function validateReplacementBlocks(
	content: BlockJson[],
	current: BlockJson[],
) {
	const bounded = CreatePageInputSchema.shape.initialContent
		.unwrap()
		.safeParse(content);
	if (!bounded.success)
		invalid("Page content exceeds the supported size, depth, or block limits.");
	const previous = new Map<string, BlockJson>();
	const index = (blocks: BlockJson[]) => {
		for (const block of blocks) {
			previous.set(block.id, block);
			index(block.children);
		}
	};
	index(current);
	const ids = new Set<string>();
	const visit = (blocks: BlockJson[]) => {
		for (const block of blocks) {
			if (!block.id || ids.has(block.id))
				invalid("Block IDs must be nonempty and unique within a page.");
			ids.add(block.id);
			if (EditableBlockTypeSchema.safeParse(block.type).success)
				validateEditableBlock(block);
			else if (
				!isDeepStrictEqual(
					JSON.parse(JSON.stringify(block)),
					JSON.parse(JSON.stringify(previous.get(block.id) ?? null)),
				)
			)
				invalid(
					`Replacement must preserve existing ${block.type} blocks unchanged.`,
				);
			visit(block.children);
		}
	};
	visit(content);
}

function groupOf(doc: Y.Doc): Y.XmlElement {
	const group = doc.getXmlFragment(PAGE_BODY_FRAGMENT).get(0);
	if (!(group instanceof Y.XmlElement)) invalid("The page body is invalid.");
	return group;
}

function containerOf(doc: Y.Doc, id: string): Y.XmlElement {
	for (const node of doc
		.getXmlFragment(PAGE_BODY_FRAGMENT)
		.createTreeWalker(() => true)) {
		if (
			node instanceof Y.XmlElement &&
			node.nodeName === "blockContainer" &&
			node.getAttribute("id") === id
		)
			return node;
	}
	return invalid(`Block ${id} no longer exists. Read the page again.`);
}

function blockOf(doc: Y.Doc, id: string): BlockJson {
	const visit = (blocks: BlockJson[]): BlockJson | undefined => {
		for (const block of blocks) {
			if (block.id === id) return block;
			const nested = visit(block.children);
			if (nested) return nested;
		}
	};
	return (
		visit(projectPageBody(doc)) ??
		invalid(`Block ${id} no longer exists. Read the page again.`)
	);
}

function newContainer(block: BlockJson): Y.XmlElement {
	validateEditableBlock(block);
	const source = seedPageBody([block]);
	try {
		const container = groupOf(source).get(0);
		if (!(container instanceof Y.XmlElement)) invalid("Invalid block content.");
		return container.clone();
	} finally {
		source.destroy();
	}
}

function childGroup(parent: Y.XmlElement): Y.XmlElement {
	const existing = parent
		.toArray()
		.find(
			(node) => node instanceof Y.XmlElement && node.nodeName === "blockGroup",
		);
	if (existing instanceof Y.XmlElement) return existing;
	const group = new Y.XmlElement("blockGroup");
	parent.insert(parent.length, [group]);
	return group;
}

/** Mutate only addressed Yjs nodes. Never rebuild the document for a targeted edit. */
export function editDocumentBlocks(
	doc: Y.Doc,
	operations: PageBlockOperation[],
) {
	const insertedBlockIds: string[] = [];
	for (const operation of operations) {
		if (operation.op === "insert") {
			const group = operation.parentBlockId
				? childGroup(containerOf(doc, operation.parentBlockId))
				: groupOf(doc);
			let position = 0;
			if (operation.afterBlockId !== null) {
				const anchor = containerOf(doc, operation.afterBlockId);
				if (anchor.parent !== group)
					invalid("The insertion anchor must belong to the specified parent.");
				position = group.toArray().indexOf(anchor) + 1;
			}
			const blocks = operation.blocks.map(
				(block): BlockJson => ({
					...block,
					id: crypto.randomUUID(),
					props: block.props ?? {},
					children: [],
				}),
			);
			const nodes = blocks.map(newContainer);
			group.insert(position, nodes);
			insertedBlockIds.push(...blocks.map((block) => block.id));
			continue;
		}
		const container = containerOf(doc, operation.blockId);
		if (operation.op === "move") {
			const destinationParent = operation.parentBlockId
				? containerOf(doc, operation.parentBlockId)
				: null;
			if (
				destinationParent &&
				(destinationParent === container ||
					[...container.createTreeWalker(() => true)].includes(
						destinationParent,
					))
			)
				invalid(
					"A block cannot be moved into itself or one of its descendants.",
				);
			if (operation.afterBlockId === operation.blockId)
				invalid("A block cannot be its own move anchor.");
			const group = destinationParent
				? childGroup(destinationParent)
				: groupOf(doc);
			const anchor =
				operation.afterBlockId === null
					? null
					: containerOf(doc, operation.afterBlockId);
			if (anchor && anchor.parent !== group)
				invalid("The move anchor must belong to the specified parent.");
			const source = container.parent;
			if (!(source instanceof Y.XmlElement)) invalid("Invalid block parent.");
			if (
				source !== group &&
				source.length === 1 &&
				source.parent instanceof Y.XmlElement
			)
				invalid(
					"Moving the last child out of a nested block is not supported safely during collaboration. Leave another child in that parent before moving this block.",
				);
			const sourceIndex = source.toArray().indexOf(container);
			let destinationIndex = anchor ? group.toArray().indexOf(anchor) + 1 : 0;
			if (source === group && sourceIndex < destinationIndex)
				destinationIndex--;
			if (source === group && sourceIndex === destinationIndex) continue;
			// Yjs integrated XML nodes cannot be reparented. Clone just this subtree,
			// retaining BlockNote IDs, attributes, rich content, and canvas references.
			const moved = container.clone();
			source.delete(sourceIndex, 1);
			group.insert(destinationIndex, [moved]);
			recordBlockMove(doc, moved);
			continue;
		}
		if (operation.op === "delete") {
			const block = blockOf(doc, operation.blockId);
			if (block.children.length && operation.deleteChildren !== true)
				invalid(
					"This block has children. Set deleteChildren to true to delete its subtree.",
				);
			const parent = container.parent;
			if (!(parent instanceof Y.XmlElement)) invalid("Invalid block parent.");
			parent.delete(parent.toArray().indexOf(container), 1);
			continue;
		}
		const block = blockOf(doc, operation.blockId);
		const candidate = {
			...block,
			props: { ...block.props, ...operation.props },
			...(operation.content !== undefined
				? { content: operation.content }
				: {}),
		};
		validateEditableBlock(candidate);
		const content = container.get(0);
		if (!(content instanceof Y.XmlElement)) invalid("Invalid block content.");
		for (const [key, value] of Object.entries(operation.props ?? {}))
			content.setAttribute(key, value as never);
		if (operation.content !== undefined) {
			const source = seedPageBody([{ ...candidate, children: [] }]);
			try {
				const sourceContainer = groupOf(source).get(0) as Y.XmlElement;
				updateInlineContent(content, sourceContainer.get(0) as Y.XmlElement);
			} finally {
				source.destroy();
			}
		}
	}
	// BlockNote requires at least one body block, including after deleting the last one.
	if (!groupOf(doc).length) {
		const id = crypto.randomUUID();
		groupOf(doc).insert(0, [
			newContainer({
				id,
				type: "paragraph",
				props: {},
				content: [],
				children: [],
			}),
		]);
		insertedBlockIds.push(id);
	}
	return insertedBlockIds;
}
