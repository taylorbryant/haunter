import { describe, expect, test } from "bun:test";
import { createEditorPersistenceController } from "@/features/pages/client/editor-persistence-controller";

describe("editor persistence controller", () => {
	test("coalesces edits into the latest autosave deadline", async () => {
		let saves = 0;
		const controller = createEditorPersistenceController({
			autosaveDelayMs: 5,
			onAutosave: () => {
				saves += 1;
			},
		});

		controller.markChanged();
		controller.scheduleAutosave();
		controller.scheduleAutosave();
		await Bun.sleep(15);

		expect(saves).toBe(1);
		expect(controller.dirty).toBe(true);
		controller.dispose();
	});

	test("keeps edits dirty after a failed save", () => {
		const controller = createEditorPersistenceController({
			autosaveDelayMs: 1,
			onAutosave: () => {},
		});
		controller.markChanged();

		expect(controller.beginSave()).toBe(true);
		expect(controller.dirty).toBe(false);
		controller.markSaveFailed();
		expect(controller.dirty).toBe(true);
	});

	test("requires an explicit override before saving a conflict", () => {
		const controller = createEditorPersistenceController({
			initiallyDirty: true,
			initialConflict: true,
			autosaveDelayMs: 1,
			onAutosave: () => {},
		});

		expect(controller.beginSave()).toBe(false);
		controller.allowConflictSave = true;
		expect(controller.beginSave()).toBe(true);
	});
});
