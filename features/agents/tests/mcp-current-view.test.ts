import { afterEach, expect, test } from "bun:test";
import {
	createCompanionContext,
	type ContextSnapshot,
	type CurrentPageContext,
} from "../mcp-app/model-context";
import { childId, destination, pageId } from "./mcp-app-fixture";

const contexts: ReturnType<typeof createCompanionContext>[] = [];
afterEach(() => {
	for (const context of contexts.splice(0)) context.dispose();
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function pageView(id = pageId): CurrentPageContext {
	const output = destination(id);
	return {
		workspaceId: output.workspaceId,
		workspaceName: "Product",
		pageId: id,
		title: output.title,
		url: output.webUrl,
		source: `haunter://workspaces/workspace-one/pages/${id}`,
		editorStatus: "ready",
		saveStatus: "saved",
	};
}
function fixture(
	options: Partial<Parameters<typeof createCompanionContext>[0]> = {},
) {
	const snapshots: ContextSnapshot[] = [];
	const context = createCompanionContext({
		canUseContext: () => true,
		changed() {},
		async setContext(snapshot) {
			snapshots.push(snapshot);
			return { updateId: `update-${snapshots.length}` };
		},
		...options,
	});
	contexts.push(context);
	return {
		context,
		snapshots,
		current: () => snapshots.at(-1),
		async update(view?: CurrentPageContext) {
			context.setView(view);
			await settle();
		},
	};
}

test("current-page metadata tracks renames and save status without duplicating unchanged context", async () => {
	const f = fixture();
	await f.update({
		...pageView(),
		editorStatus: "opening",
		saveStatus: "unknown",
	});
	expect(f.current()?.structuredContent.haunterView?.editorStatus).toBe(
		"opening",
	);
	const renamed = {
		...pageView(),
		title: "Renamed launch",
		saveStatus: "unsaved" as const,
	};
	await f.update(renamed);
	expect(f.current()?.structuredContent.haunterView).toEqual(renamed);
	expect(f.current()?.structuredContent.haunterPage).toBeNull();
	expect(f.current()?.content[0].text).toContain(
		"full page body is not included",
	);
	await f.update({ ...renamed, saveStatus: "saved" });
	const count = f.snapshots.length;
	await f.update({ ...renamed, saveStatus: "saved" });
	expect(f.snapshots).toHaveLength(count);
});

test("navigation replaces the live selection and clearing the view removes its context", async () => {
	const f = fixture();
	await f.update({
		...pageView(),
		selection: { text: "Selected passage", complete: true },
	});
	expect(f.current()?.content[0].text).toContain("may include unsaved changes");
	await f.update(pageView(childId));
	expect(f.current()?.structuredContent.haunterView?.pageId).toBe(childId);
	expect(f.current()?.content[0].text).not.toContain("Selected passage");
	await f.context.clearView();
	expect(f.current()?.structuredContent.haunterView).toBeNull();
});

test("host removal suppresses a selection until it changes, including stale acknowledgements", async () => {
	const f = fixture();
	f.context.sync(null);
	const selected = {
		...pageView(),
		selection: { text: "Selected passage", complete: true },
	};
	await f.update(selected);
	const previous = f.current();
	const updateId = `update-${f.snapshots.length}`;
	f.context.sync(null);
	f.context.sync({ ...previous, updateId });
	await f.update({ ...selected, saveStatus: "unsaved" });
	expect(f.current()?.structuredContent.haunterView?.selection).toBeUndefined();
	expect(f.current()?.structuredContent.haunterView?.pageId).toBe(pageId);
	await f.update({
		...selected,
		selection: { text: "A different selection", complete: true },
	});
	expect(f.current()?.structuredContent.haunterView?.selection?.text).toBe(
		"A different selection",
	);
});

test("a previous host selection is never restored into another page", async () => {
	const first = fixture();
	await first.update({
		...pageView(),
		selection: { text: "Old selection", complete: true },
	});
	const snapshot = first.current();
	first.context.dispose();
	const next = fixture();
	next.context.sync({ ...snapshot, updateId: "old-context" });
	await next.update(pageView(childId));
	expect(next.current()?.structuredContent.haunterView?.pageId).toBe(childId);
	expect(next.current()?.content[0].text).not.toContain("Old selection");
});

for (const change of ["deselect", "navigate", "dismiss"] as const) {
	test(`${change} during a pending context write wins over the old selection`, async () => {
		const received: ContextSnapshot[] = [];
		let release = () => {};
		let block = false;
		const f = fixture({
			async setContext(snapshot) {
				received.push(snapshot);
				if (block)
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				return { updateId: `received-${received.length}` };
			},
		});
		await f.update(pageView());
		block = true;
		await f.update({
			...pageView(),
			selection: { text: "Stale selection", complete: true },
		});
		expect(
			received.at(-1)?.structuredContent.haunterView?.selection?.text,
		).toBe("Stale selection");
		if (change === "dismiss") f.context.sync(null);
		else f.context.setView(pageView(change === "navigate" ? childId : pageId));
		block = false;
		release();
		await settle();
		expect(
			received.at(-1)?.structuredContent.haunterView?.selection,
		).toBeUndefined();
		expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(
			change === "navigate" ? childId : pageId,
		);
	});
}

test("context errors are retried with the latest page", async () => {
	let fail = true;
	const received: ContextSnapshot[] = [];
	const f = fixture({
		async setContext(snapshot) {
			if (fail) throw new Error("Host unavailable");
			received.push(snapshot);
		},
	});
	await f.update(pageView());
	expect(f.context.error).toBeTrue();
	fail = false;
	await f.update(pageView(childId));
	expect(received.at(-1)?.structuredContent.haunterView?.pageId).toBe(childId);
	expect(f.context.error).toBeFalse();
});

test("unsupported hosts and disposed contexts do not receive selections", async () => {
	const unsupported = fixture({ canUseContext: () => false });
	await unsupported.update(pageView());
	expect(unsupported.snapshots).toEqual([]);
	const f = fixture();
	await f.update(pageView());
	await f.context.clearView();
	f.context.dispose();
	await f.update(pageView(childId));
	expect(f.current()?.structuredContent.haunterView).toBeNull();
});
