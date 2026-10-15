import { expect, test } from "bun:test";
import { validateEditorOutput } from "../mcp-app/editor-schema";
import { parsePageResourceUri } from "../mcp-app/schemas";
import { canvasDestination, destination, pageId } from "./mcp-app-fixture";

test("editor destinations reject scripts, another origin, or a different page path", () => {
	const output = destination();
	expect(validateEditorOutput(output)).toEqual(output);
	for (const changed of [
		{ editorUrl: "javascript:alert(1)" },
		{ editorUrl: output.editorUrl.replace("haunter.test", "other.test") },
		{ editorUrl: `${output.editorUrl}?page=another` },
		{ webUrl: "https://haunter.test/settings" },
		{
			editorUrl: output.editorUrl.replace("https:", "http:"),
			webUrl: output.webUrl.replace("https:", "http:"),
		},
	])
		expect(() => validateEditorOutput({ ...output, ...changed })).toThrow();
});

test("canvas destinations bind the resource and reject page paths or other origins", () => {
	expect(validateEditorOutput(canvasDestination)).toEqual(canvasDestination);
	for (const changed of [
		{ canvasId: crypto.randomUUID() },
		{ editorUrl: destination().editorUrl },
		{ webUrl: "https://other.test/" },
	])
		expect(() =>
			validateEditorOutput({ ...canvasDestination, ...changed }),
		).toThrow();
});

test("page resource identifiers reject noncanonical paths", () => {
	for (const uri of [
		`haunter://workspaces/workspace-one/pages/${pageId}/extra`,
		`haunter://workspaces/%2e%2e/pages/${pageId}`,
		`file:///tmp/${pageId}`,
	])
		expect(() => parsePageResourceUri(uri)).toThrow();
});
