import {
	DefaultFontFaces,
	defaultEditorAssetUrls,
	type TLFontFace,
} from "tldraw";

type SnapshotLike = {
	store?: Record<string, unknown>;
};

type ShapeRecordLike = {
	typeName?: unknown;
	props?: {
		font?: unknown;
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
	const fontNames = new Set<string>();
	for (const value of Object.values(snapshot?.store ?? {})) {
		const record = value as ShapeRecordLike;
		if (record.typeName !== "shape") continue;
		if (typeof record.props?.font === "string") {
			fontNames.add(record.props.font);
		}
	}
	if (fontNames.size === 0) fontNames.add("draw");

	const faces: TLFontFace[] = [];
	for (const fontName of [...fontNames].sort()) {
		const family =
			DefaultFontFaces[`tldraw_${fontName}` as keyof typeof DefaultFontFaces];
		if (!family) continue;
		for (const style of Object.values(family)) {
			faces.push(...(Object.values(style) as TLFontFace[]));
		}
	}
	return faces;
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
