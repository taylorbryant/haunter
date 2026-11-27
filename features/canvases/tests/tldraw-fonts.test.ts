import { describe, expect, it } from "bun:test";
import {
	requiredTldrawFontFaces,
	tldrawFontFaceKey,
} from "@/features/canvases/client/tldraw-fonts";

const shape = (type: string, props: object) => ({
	typeName: "shape",
	type,
	props,
});

describe("tldraw font preloading", () => {
	it("mounts blank, freehand and unlabeled drawings without waiting for fonts", () => {
		expect(requiredTldrawFontFaces(undefined)).toEqual([]);
		expect(
			requiredTldrawFontFaces({
				store: {
					page: { typeName: "page" },
					pen: shape("draw", { segments: [] }),
					geo: shape("geo", {
						font: "draw",
						richText: { content: [{ type: "paragraph" }] },
					}),
					arrow: shape("arrow", { font: "mono", text: "" }),
					note: shape("note", {
						textLastEditedBy: "user",
						richText: { content: [] },
					}),
					frame: shape("frame", { name: "A frame" }),
				},
			}),
		).toEqual([]);
	});

	it("preloads the faces used by labels, styled text, code and attributed notes", () => {
		const richText = {
			content: [
				{
					content: [
						{
							text: "bold italic",
							marks: [{ type: "bold" }, { type: "italic" }],
						},
						{ text: "code", marks: [{ type: "code" }] },
					],
				},
			],
		};
		const faces = requiredTldrawFontFaces({
			store: {
				text: shape("text", { font: "serif", richText }),
				geo: shape("geo", { font: "serif", richText }),
				note: shape("note", {
					font: "mono",
					text: "legacy note",
					textLastEditedBy: "user",
				}),
				arrow: shape("arrow", { text: "legacy label" }),
				custom: shape("text", { font: "custom", text: "custom face" }),
				session: {
					typeName: "instance",
					props: { text: "ignored", font: "serif" },
				},
			},
		});
		expect(faces.map(tldrawFontFaceKey).sort()).toEqual([
			"tldraw_draw:normal:normal",
			"tldraw_mono:normal:normal",
			"tldraw_sans:normal:normal",
			"tldraw_serif:italic:bold",
		]);
	});
});
