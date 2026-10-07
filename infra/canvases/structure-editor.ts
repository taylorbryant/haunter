import { isAppError } from "@beignet/core/errors";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import type { CanvasStructureEditor } from "@/features/canvases/ports";
import { appError } from "@/features/shared/errors";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import {
	createCanvasBrowserRunner,
	canvasBrowserOrigin,
	type CanvasBrowserRunner,
} from "./browser-runtime";
import type {
	BrowserStructureInput,
	editCanvasStructure,
} from "./structure-browser";

export function createCanvasStructureEditor(
	options: { licenseKey?: string; runner?: CanvasBrowserRunner } = {},
): CanvasStructureEditor & { stop(): Promise<void> } {
	const runner = options.runner ?? createCanvasBrowserRunner();
	return {
		async prepare(input) {
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
				return await runner.run("structure", async (job) => {
					const page = await job.page();
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
				// The shared runner emits bounded metrics without logging drawing content.
				throw appError("CanvasWorkerUnavailable");
			}
		},
		stop: options.runner ? async () => {} : runner.stop,
	};
}
