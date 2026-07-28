import { defaultShapeUtils, TextShapeUtil, type TLTextShape } from "tldraw";

export function textAutoSizeWidthWithSafetyMargin(width: number): number {
	return Math.ceil(width) + 1;
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
}

export const haunterShapeUtils = defaultShapeUtils.map((ShapeUtil) =>
	ShapeUtil === TextShapeUtil ? HaunterTextShapeUtil : ShapeUtil,
);
