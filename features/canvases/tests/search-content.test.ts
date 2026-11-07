import { expect, test } from "bun:test";
import { canvasSearchContent } from "../lib/search-content";

const richText = (...paragraphs: unknown[][]) => ({
	type: "doc",
	content: paragraphs.map((content) => ({ type: "paragraph", content })),
});

test("projects visible text from indexed shape types only", () => {
	expect(
		canvasSearchContent({
			store: {
				"shape:frame": {
					id: "shape:frame",
					typeName: "shape",
					type: "frame",
					props: { name: "  Planning  " },
				},
				"shape:legacy": {
					id: "shape:legacy",
					typeName: "shape",
					type: "text",
					props: { text: "Legacy notes" },
				},
				"shape:note": {
					id: "shape:note",
					typeName: "shape",
					type: "note",
					props: { richText: richText([{ type: "text", text: "Sticky" }]) },
				},
				"shape:arrow": {
					id: "shape:arrow",
					typeName: "shape",
					type: "arrow",
					props: { richText: richText([{ type: "text", text: "Label" }]) },
				},
				"shape:geo": {
					id: "shape:geo",
					typeName: "shape",
					type: "geo",
					props: { richText: richText([{ type: "text", text: "Box" }]) },
				},
				"shape:image": {
					id: "shape:image",
					typeName: "shape",
					type: "image",
					meta: { text: "hidden metadata" },
					props: { text: "hidden image text" },
				},
				"asset:image": {
					id: "asset:image",
					typeName: "asset",
					props: { src: "https://private.invalid/secret", name: "hidden" },
				},
				"camera:page": { id: "camera:page", typeName: "camera", x: 1, y: 2 },
			},
		}),
	).toEqual([
		{ shapeId: "shape:frame", text: "Planning" },
		{ shapeId: "shape:legacy", text: "Legacy notes" },
		{ shapeId: "shape:note", text: "Sticky" },
		{ shapeId: "shape:arrow", text: "Label" },
		{ shapeId: "shape:geo", text: "Box" },
	]);
});

test("joins rich text runs and separates paragraphs and hard breaks like the trigger", () => {
	expect(
		canvasSearchContent({
			store: {
				"shape:rich": {
					id: "shape:rich",
					typeName: "shape",
					type: "text",
					props: {
						richText: richText(
							[
								{ type: "text", text: "Ship" },
								{ type: "text", text: "ping", marks: [{ type: "bold" }] },
							],
							[
								{ type: "text", text: "tomorrow" },
								{ type: "hardBreak" },
								{ type: "text", text: "morning" },
							],
						),
					},
				},
			},
		}),
	).toEqual([{ shapeId: "shape:rich", text: "Shipping tomorrow morning" }]);
});

test("skips empty text, missing ids, rich text that is not an object, and malformed snapshots", () => {
	expect(
		canvasSearchContent({
			store: {
				"shape:blank": {
					id: "shape:blank",
					typeName: "shape",
					type: "text",
					props: { richText: richText([]) },
				},
				"shape:spaces": {
					id: "shape:spaces",
					typeName: "shape",
					type: "note",
					props: { text: "   " },
				},
				"shape:anonymous": {
					typeName: "shape",
					type: "text",
					props: { text: "no id" },
				},
				"shape:array": {
					id: "shape:array",
					typeName: "shape",
					type: "text",
					props: {
						richText: [{ type: "text", text: "array" }],
						text: "fallback",
					},
				},
				"shape:untyped": { id: "shape:untyped", typeName: "shape" },
				"shape:string": "not a record",
			},
		}),
	).toEqual([{ shapeId: "shape:array", text: "fallback" }]);
	expect(canvasSearchContent({})).toEqual([]);
	expect(canvasSearchContent({ store: [] })).toEqual([]);
	expect(canvasSearchContent(null)).toEqual([]);
	expect(canvasSearchContent("{}")).toEqual([]);
});
