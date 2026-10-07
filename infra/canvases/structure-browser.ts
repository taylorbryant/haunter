// Bundled for an isolated Chromium page, never imported into the worker runtime.
import { isAppError } from "@beignet/core/errors";
import {
	Editor,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	SelectTool,
	defaultAddFontsFromNode,
	tipTapDefaultExtensions,
	type TLStoreSnapshot,
} from "tldraw";
import type { CanvasCommand } from "@/features/canvases/editing";
import { prepareCanvasStructureEdit } from "./structure-edits";

export type BrowserStructureInput = {
	snapshot: TLStoreSnapshot;
	command: Extract<CanvasCommand, { action: "edit" }>;
	fontAssetUrls: Record<string, string>;
	licenseKey?: string;
};
export async function editCanvasStructure(input: BrowserStructureInput) {
	const container = document.createElement("div");
	container.className = "tl-container tl-theme__light";
	container.style.cssText = "position:fixed;width:1600px;height:1600px;";
	document.body.appendChild(container);
	const editor = new Editor({
		store: createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
			snapshot: input.snapshot,
		}),
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [SelectTool],
		initialState: "select",
		getContainer: () => container,
		fontAssetUrls: input.fontAssetUrls,
		licenseKey: input.licenseKey,
		options: {
			text: {
				tipTapConfig: { extensions: tipTapDefaultExtensions },
				addFontsFromNode: defaultAddFontsFromNode,
			},
		},
	});
	try {
		return {
			edit: await prepareCanvasStructureEdit(
				editor,
				input.snapshot,
				input.command,
			),
		};
	} catch (error) {
		if (isAppError(error) && error.code === "INVALID_CANVAS_EDIT")
			return { error: error.message };
		throw error;
	} finally {
		editor.dispose();
		container.remove();
	}
}
Object.assign(window, { editCanvasStructure });
