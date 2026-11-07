/**
 * Visible drawing text for workspace search, projected from a canvas snapshot.
 *
 * This is the application-side replacement for the `canvases_search_*`
 * database triggers from migration 0049 and keeps their exact semantics: only
 * shapes of the listed types contribute, a frame contributes its name, a
 * rich-text shape contributes its text nodes in document order with paragraphs
 * and hard breaks separated by a space, and legacy shapes contribute
 * `props.text`. Geometry, asset URLs, metadata and camera or selection state
 * are never indexed.
 */
export type CanvasSearchEntry = { shapeId: string; text: string };

const INDEXED_SHAPE_TYPES = new Set(["text", "note", "geo", "arrow", "frame"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrEmpty(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Concatenate a ProseMirror document's text the way the search trigger did. */
export function richTextSearchText(richText: unknown): string {
	let text = "";
	const walk = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (!isRecord(value)) return;
		for (const [key, child] of Object.entries(value)) {
			if (key === "text" && typeof child === "string" && value.type === "text")
				text += child;
			else if (
				key === "type" &&
				(child === "paragraph" || child === "hardBreak")
			)
				text += " ";
			walk(child);
		}
	};
	walk(richText);
	return text;
}

export function canvasSearchContent(snapshot: unknown): CanvasSearchEntry[] {
	const store =
		isRecord(snapshot) && isRecord(snapshot.store) ? snapshot.store : null;
	if (!store) return [];
	const entries: CanvasSearchEntry[] = [];
	for (const record of Object.values(store)) {
		if (!isRecord(record) || record.typeName !== "shape") continue;
		if (
			typeof record.type !== "string" ||
			!INDEXED_SHAPE_TYPES.has(record.type)
		)
			continue;
		const props = isRecord(record.props) ? record.props : {};
		const text = (
			record.type === "frame"
				? stringOrEmpty(props.name)
				: isRecord(props.richText)
					? richTextSearchText(props.richText)
					: stringOrEmpty(props.text)
		).trim();
		if (!text || typeof record.id !== "string") continue;
		entries.push({ shapeId: record.id, text });
	}
	return entries;
}
