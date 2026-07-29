import {
	defaultShapeUtils,
	TextShapeUtil,
	type TLTextShape,
	Vec,
} from "tldraw";

export function textAutoSizeWidthWithSafetyMargin(width: number): number {
	return Math.ceil(width) + 1;
}

export function scaledTextAutoSizeWidthWithSafetyMargin(
	scaledWidth: number,
	scale: number,
): number {
	return textAutoSizeWidthWithSafetyMargin(scaledWidth / scale) * scale;
}

export function textAutoSizeAlignmentCorrection(
	scaledMeasuredWidth: number,
	textAlign: TLTextShape["props"]["textAlign"],
	scale: number,
): number {
	const safetyMargin =
		scaledTextAutoSizeWidthWithSafetyMargin(scaledMeasuredWidth, scale) -
		scaledMeasuredWidth;
	if (textAlign === "middle") return safetyMargin / 2;
	if (textAlign === "end") return safetyMargin;
	return 0;
}

/**
 * Chromium can report a rich-text block's max-content width slightly below
 * the inline glyph advance. tldraw adds one pixel before rendering, but the
 * final integer width can still land a fraction short and wrap the last
 * character. Give auto-sized text one additional whole-pixel safety margin.
 */
class HaunterTextShapeUtil extends TextShapeUtil {
	override getMinDimensions(shape: TLTextShape) {
		const dimensions = super.getMinDimensions(shape);
		if (!shape.props.autoSize) return dimensions;
		return {
			...dimensions,
			width: textAutoSizeWidthWithSafetyMargin(dimensions.width),
		};
	}

	override onBeforeUpdate(prev: TLTextShape, next: TLTextShape) {
		const update = super.onBeforeUpdate(prev, next);
		const measuredWidth = update?.props?.w;
		if (!update || !next.props.autoSize || typeof measuredWidth !== "number") {
			return update;
		}

		const paddedWidth = scaledTextAutoSizeWidthWithSafetyMargin(
			measuredWidth,
			next.props.scale,
		);
		// TextShapeUtil computes alignment movement with this override's padded
		// previous width but its private, unpadded next measurement. Correct the
		// persisted position so centered/end-aligned text keeps its anchor.
		const correction = textAutoSizeAlignmentCorrection(
			measuredWidth,
			next.props.textAlign,
			next.props.scale,
		);
		const rotatedCorrection = new Vec(correction, 0).rot(next.rotation);

		return {
			...update,
			x: (update.x ?? next.x) - rotatedCorrection.x,
			y: (update.y ?? next.y) - rotatedCorrection.y,
			props: {
				...update.props,
				w: paddedWidth,
			},
		};
	}
}

export const haunterShapeUtils = defaultShapeUtils.map((ShapeUtil) =>
	ShapeUtil === TextShapeUtil ? HaunterTextShapeUtil : ShapeUtil,
);
