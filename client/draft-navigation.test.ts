import { expect, test } from "bun:test";
import { draftRegistry, type RegisteredDraft } from "./draft-registry";
import { navigateWithDrafts } from "./use-draft-safe-router";

test("command navigation waits for the latest local commit and stops on storage failure", async () => {
	let durable = false;
	let fail = false;
	let finish!: () => void;
	let navigationCount = 0;
	const draft: RegisteredDraft = {
		identity: {
			key: "navigation-test",
			userId: "navigation-test",
			workspaceId: "workspace",
			resourceId: "page",
			resourceType: "page",
		},
		getSnapshot: () => ({
			value: "Latest text",
			serverValue: "Older text",
			serverVersion: "v1",
			error: null,
			validationError: null,
			status: durable ? "paused" : "saving-local",
			dirty: true,
			locallySaved: durable,
		}),
		subscribe: () => () => {},
		pause: () => {},
		resume: () => {},
		flushServer: async () => false,
		flushLocal: async () => {
			if (fail) throw new Error("quota");
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			durable = true;
		},
	};
	const unregister = draftRegistry.register(draft);
	try {
		const pending = navigateWithDrafts(() => navigationCount++);
		expect(navigationCount).toBe(0);
		finish();
		expect(await pending).toBe(true);
		expect(navigationCount).toBe(1);
		durable = false;
		fail = true;
		expect(await navigateWithDrafts(() => navigationCount++)).toBe(false);
		expect(navigationCount).toBe(1);
	} finally {
		unregister();
	}
});
