import { describe, expect, it } from "bun:test";
import {
	requiredTldrawFontFaces,
	tldrawFontFaceKey,
} from "@/features/canvases/client/tldraw-fonts";

describe("tldraw font preloading", () => {
	it("collects every style variant for each built-in font used by shapes", () => {
		const faces = requiredTldrawFontFaces({
			store: {
				"shape:one": {
					typeName: "shape",
					props: { font: "draw" },
				},
				"shape:two": {
					typeName: "shape",
					props: { font: "draw" },
				},
				"shape:three": {
					typeName: "shape",
					props: { font: "mono" },
				},
			},
		});

		expect(faces).toHaveLength(8);
		expect(new Set(faces.map(tldrawFontFaceKey))).toEqual(
			new Set([
				"tldraw_draw:normal:normal",
				"tldraw_draw:normal:bold",
				"tldraw_draw:italic:normal",
				"tldraw_draw:italic:bold",
				"tldraw_mono:normal:normal",
				"tldraw_mono:normal:bold",
				"tldraw_mono:italic:normal",
				"tldraw_mono:italic:bold",
			]),
		);
	});

	it("ignores session records and unknown font families", () => {
		const faces = requiredTldrawFontFaces({
			store: {
				"instance:one": {
					typeName: "instance",
					props: { font: "draw" },
				},
				"shape:custom": {
					typeName: "shape",
					props: { font: "custom" },
				},
			},
		});

		expect(faces).toEqual([]);
	});

	it("preloads the default drawing font for a blank canvas", () => {
		const faces = requiredTldrawFontFaces(undefined);

		expect(faces).toHaveLength(4);
		expect(faces.every((face) => face.family === "tldraw_draw")).toBe(true);
	});
});
