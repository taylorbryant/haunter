import { isAppError } from "@beignet/core/errors";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import type { CanvasStructureEditor } from "@/features/canvases/ports";
import { appError } from "@/features/shared/errors";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import {
	createCanvasBrowserRunner,
	canvasBrowserOrigin,
} from "./browser-runtime";
import type {
	BrowserStructureInput,
	editCanvasStructure,
} from "./structure-browser";

export function createCanvasStructureEditor(
	options: { licenseKey?: string } = {},
): CanvasStructureEditor & { stop(): Promise<void> } {
	const runner = createCanvasBrowserRunner();
	return {
		async prepare(input) {
			if (!runner.available) throw appError("CanvasWorkerUnavailable");
			if (
				Object.values(input.snapshot.store).filter(
					(r) => r.typeName === "shape",
				).length > 1000
			)
				throw appError("InvalidCanvasEdit", {
					message:
						"Canvas organization supports at most 1,000 shapes per canvas.",
				});
			try {
				return await runner.run(async (page) => {
					const result = await page.evaluate(
						(serialized: string) =>
							(
								window as unknown as {
									editCanvasStructure: typeof editCanvasStructure;
								}
							).editCanvasStructure(
								JSON.parse(serialized) as BrowserStructureInput,
							),
						JSON.stringify({
							...input,
							fontAssetUrls: getAssetUrls({ baseUrl: canvasBrowserOrigin })
								.fonts,
							licenseKey: options.licenseKey,
						}),
					);
					if (result.error)
						throw appError("InvalidCanvasEdit", { message: result.error });
					if (!result.edit)
						throw new Error("Canvas editor did not produce an edit.");
					normalizeCanvasSnapshot({ ...result.edit.next });
					return result.edit;
				});
			} catch (error) {
				if (isAppError(error)) throw error;
				console.error("Canvas structure editor failed", error);
				throw appError("CanvasWorkerUnavailable");
			}
		},
		stop: runner.stop,
	};
}
