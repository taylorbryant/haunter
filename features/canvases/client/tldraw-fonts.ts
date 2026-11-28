import {
	DefaultFontFaces,
	defaultEditorAssetUrls,
	type TLFontFace,
} from "tldraw";

type SnapshotLike = {
	store?: Record<string, unknown>;
};

type RichTextNode = {
	text?: string;
	content?: RichTextNode[];
	marks?: { type: string }[];
};

type ShapeRecordLike = {
	type?: string;
	typeName?: unknown;
	props?: {
		font?: string;
		text?: string;
		richText?: RichTextNode;
		textLastEditedBy?: string;
	};
};

const DEFAULT_FONT_FACE_DESCRIPTORS = {
	style: "normal",
	weight: "normal",
	stretch: "normal",
	unicodeRange: "U+0-10FFFF",
	featureSettings: "normal",
	ascentOverride: "normal",
	descentOverride: "normal",
	lineGapOverride: "normal",
} as const;

/** Find the built-in tldraw font variants used by a stored document. */
export function requiredTldrawFontFaces(
	snapshot: SnapshotLike | undefined,
): TLFontFace[] {
	const faces = new Set<TLFontFace>();
	for (const value of Object.values(snapshot?.store ?? {})) {
		const shape = value as ShapeRecordLike | null;
		if (shape?.typeName !== "shape" || !shape.props) continue;
		const { richText, text, font = "draw", textLastEditedBy } = shape.props;
		// Older snapshots store plain text. Current geo and arrow records carry a
		// font even when their label is empty.
		const root = richText ?? (text ? { text } : undefined);
		if (!root) continue;
		const nodes: RichTextNode[] = [root];
		while (nodes.length) {
			const node = nodes.pop();
			if (!node) continue;
			if (Array.isArray(node.content)) {
				for (const child of node.content) nodes.push(child);
			}
			if (typeof node.text !== "string" || !node.text) continue;
			const marks = Array.isArray(node.marks) ? node.marks : [];
			const familyName = marks.some((mark) => mark?.type === "code")
				? "mono"
				: font;
			const family =
				DefaultFontFaces[
					`tldraw_${familyName}` as keyof typeof DefaultFontFaces
				];
			const style = marks.some((mark) => mark?.type === "italic")
				? "italic"
				: "normal";
			const weight = marks.some((mark) => mark?.type === "bold")
				? "bold"
				: "normal";
			if (family) faces.add(family[style][weight]);
			if (shape.type === "note" && textLastEditedBy)
				faces.add(DefaultFontFaces.tldraw_sans.normal.normal);
		}
	}
	return [...faces];
}

export function tldrawFontFaceKey(face: TLFontFace): string {
	return [
		face.family,
		face.style ?? DEFAULT_FONT_FACE_DESCRIPTORS.style,
		face.weight ?? DEFAULT_FONT_FACE_DESCRIPTORS.weight,
	].join(":");
}

let fontLoadsByDocument = new WeakMap<Document, Map<string, Promise<void>>>();

function matchingFontFace(document: Document, face: TLFontFace) {
	const style = face.style ?? DEFAULT_FONT_FACE_DESCRIPTORS.style;
	const weight = face.weight ?? DEFAULT_FONT_FACE_DESCRIPTORS.weight;
	for (const existing of document.fonts) {
		if (
			existing.family === face.family &&
			existing.style === style &&
			existing.weight === weight
		) {
			return existing;
		}
	}
	return null;
}

function loadFontFace(document: Document, face: TLFontFace): Promise<void> {
	let loads = fontLoadsByDocument.get(document);
	if (!loads) {
		loads = new Map();
		fontLoadsByDocument.set(document, loads);
	}

	const key = tldrawFontFaceKey(face);
	const existingLoad = loads.get(key);
	if (existingLoad) return existingLoad;

	const existing = matchingFontFace(document, face);
	const assetUrl =
		defaultEditorAssetUrls.fonts?.[
			face.src.url as keyof NonNullable<typeof defaultEditorAssetUrls.fonts>
		];
	let instance = existing;
	if (!instance && assetUrl) {
		instance = new FontFace(face.family, `url(${JSON.stringify(assetUrl)})`, {
			...DEFAULT_FONT_FACE_DESCRIPTORS,
			style: face.style ?? DEFAULT_FONT_FACE_DESCRIPTORS.style,
			weight: face.weight ?? DEFAULT_FONT_FACE_DESCRIPTORS.weight,
			stretch: face.stretch ?? DEFAULT_FONT_FACE_DESCRIPTORS.stretch,
			unicodeRange:
				face.unicodeRange ?? DEFAULT_FONT_FACE_DESCRIPTORS.unicodeRange,
			featureSettings:
				face.featureSettings ?? DEFAULT_FONT_FACE_DESCRIPTORS.featureSettings,
			ascentOverride:
				face.ascentOverride ?? DEFAULT_FONT_FACE_DESCRIPTORS.ascentOverride,
			descentOverride:
				face.descentOverride ?? DEFAULT_FONT_FACE_DESCRIPTORS.descentOverride,
			lineGapOverride:
				face.lineGapOverride ?? DEFAULT_FONT_FACE_DESCRIPTORS.lineGapOverride,
			display: "swap",
		});
		document.fonts.add(instance);
	}

	if (!instance) return Promise.resolve();

	const load = instance
		.load()
		.then(() => undefined)
		.catch((error) => {
			// Do not strand the canvas behind a loading state if the CDN is
			// unavailable. Removing our face lets tldraw retry its normal path.
			if (!existing) document.fonts.delete(instance);
			loads?.delete(key);
			console.warn("Could not preload a tldraw font.", error);
		});
	loads.set(key, load);
	return load;
}

/**
 * Load fonts before tldraw constructs its text measurement cache. Otherwise
 * an auto-sized shape can be measured against a fallback font, then wrap when
 * the real font appears a fraction wider.
 */
export async function preloadTldrawFonts(
	document: Document,
	faces: TLFontFace[],
): Promise<void> {
	await Promise.all(faces.map((face) => loadFontFace(document, face)));
}

/** Test-only reset for the per-document promise cache. */
export function clearTldrawFontLoadCacheForTests(): void {
	fontLoadsByDocument = new WeakMap();
}
