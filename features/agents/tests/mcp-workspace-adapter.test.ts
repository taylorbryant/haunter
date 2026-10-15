import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	createWorkspaceAdapter,
	type WorkspaceAdapterBridge,
} from "../mcp-app/workspace-adapter";
import type { ContextSnapshot } from "../mcp-app/model-context";
import {
	destination,
	childId,
	canvasDestination,
	canvasId,
} from "./mcp-app-fixture";

const hostTemplate = await Bun.file(
	new URL("../mcp-app/host.html", import.meta.url),
).text();

let adapter: ReturnType<typeof createWorkspaceAdapter>;
beforeEach(() => {
	installTestDom();
	// Keep a real contentWindow for message-source checks without loading a URL.
	document.documentElement.innerHTML = hostTemplate.replace(
		'<iframe id="real-editor"',
		'<iframe srcdoc="" id="real-editor"',
	);
	document.documentElement.dataset.appOrigin = "https://haunter.test";
});
afterEach(async () => {
	adapter?.dispose();
	await uninstallTestDom();
});

function fixture(
	toolError?: Error,
	overrides: Partial<WorkspaceAdapterBridge> = {},
) {
	const calls: string[] = [];
	const contexts: ContextSnapshot[] = [];
	const messages: Record<string, unknown>[] = [];
	const links: string[] = [];
	const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
	const frameWindow = frame.contentWindow;
	let src = "about:blank";
	let saved = true;
	let locallySaved = true;
	let autoFlush = true;
	function emit(
		data: Record<string, unknown>,
		overrides: MessageEventInit = {},
	) {
		window.dispatchEvent(
			new MessageEvent("message", {
				source: frameWindow,
				origin: "https://haunter.test",
				data: { nonce: new URL(src).searchParams.get("nonce"), ...data },
				...overrides,
			}),
		);
	}
	Object.defineProperty(frame, "src", {
		get: () => src,
		set: (next: string) => {
			src = next;
		},
	});
	Object.defineProperty(frame, "contentWindow", { get: () => frameWindow });
	Object.defineProperty(frameWindow, "postMessage", {
		value: (message: Record<string, unknown>) => {
			messages.push(message);
			if (message.type === "haunter/editor/flush" && autoFlush)
				queueMicrotask(() =>
					emit({
						type: "haunter/editor/flushed",
						requestId: message.requestId,
						saved,
						locallySaved,
					}),
				);
		},
	});
	adapter = createWorkspaceAdapter({
		async callTool(name) {
			calls.push(name);
			if (toolError) throw toolError;
			return { id: crypto.randomUUID() };
		},
		async openLink(url) {
			links.push(url);
		},
		canUseContext: () => true,
		async setContext(snapshot) {
			contexts.push(snapshot);
		},
		...overrides,
	});
	return {
		calls,
		contexts,
		messages,
		links,
		frame,
		emit,
		setSave(next: {
			saved?: boolean;
			locallySaved?: boolean;
			autoFlush?: boolean;
		}) {
			saved = next.saved ?? saved;
			locallySaved = next.locallySaved ?? locallySaved;
			autoFlush = next.autoFlush ?? autoFlush;
		},
	};
}

test("assistant page changes reuse the workspace frame and UI calls only authorize the workspace", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	const src = f.frame.src;
	f.emit({ type: "haunter/workspace/ready" });
	await adapter.initialize(destination(childId));
	expect(f.frame.src).toBe(src);
	expect(f.messages.at(-1)).toMatchObject({
		type: "haunter/workspace/navigate",
		target: { pageId: childId },
	});
	expect(f.calls).toEqual([]);
	const request = {
		type: "haunter/workspace/authorize",
		workspaceId: "workspace-one",
		requestId: crypto.randomUUID(),
		challenge: "a".repeat(43),
	};
	f.emit(request, { origin: "https://other.test" });
	f.emit({ ...request, nonce: "wrong" });
	expect(f.calls).toEqual([]);
	f.emit(request);
	await waitFor(() =>
		expect(f.messages.at(-1)).toMatchObject({
			type: "haunter/editor/authorized",
			requestId: request.requestId,
		}),
	);
	expect(f.calls).toEqual(["authorize_haunter_workspace"]);
});

test("authorization forwards the host failure to the requesting frame without a handoff", async () => {
	const f = fixture(new Error("Unknown tool: authorize_haunter_workspace"));
	await adapter.initialize(destination());
	const requestId = crypto.randomUUID();
	f.emit({
		type: "haunter/workspace/authorize",
		workspaceId: "workspace-one",
		requestId,
		challenge: "a".repeat(43),
	});
	await waitFor(() =>
		expect(f.messages.at(-1)).toMatchObject({
			type: "haunter/editor/authorized",
			requestId,
			error: true,
			message: "Unknown tool: authorize_haunter_workspace",
		}),
	);
	expect(f.messages.at(-1)).not.toHaveProperty("handoff");
});

test("context rejects wrong server destinations and teardown retains context when saving fails", async () => {
	const f = fixture();
	const output = destination();
	await adapter.initialize(output);
	f.emit({ type: "haunter/workspace/ready" });
	const view = {
		workspaceId: output.workspaceId,
		workspaceName: "Product",
		pageId: output.pageId,
		title: "Launch",
		url: output.webUrl,
		source: "Haunter",
		editorStatus: "ready",
		saveStatus: "saved",
		selection: { text: "Selected passage", complete: true },
	};
	f.emit({
		type: "haunter/workspace/view",
		view: { ...view, url: "https://other.test/private" },
	});
	expect(f.contexts).toHaveLength(0);
	f.emit({ type: "haunter/workspace/view", view });
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.selection?.text,
		).toBe("Selected passage"),
	);
	f.setSave({ saved: false });
	await expect(adapter.prepareClose()).rejects.toThrow("unsaved");
	expect(f.contexts.at(-1)?.structuredContent.haunterView?.pageId).toBe(
		output.pageId,
	);
	expect(f.messages.at(-1)?.type).toBe("haunter/editor/resume");
});

test("successful teardown clears the current view after the workspace acknowledges saves", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	f.emit({ type: "haunter/workspace/ready" });
	await adapter.prepareClose();
	expect(f.contexts.at(-1)?.structuredContent.haunterView).toBeNull();
});

test("assistant task navigation retains the editor and rejects unauthorized workspaces", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	f.emit({ type: "haunter/workspace/ready" });
	const src = f.frame.src;
	const target = {
		workspaceId: "workspace-one",
		view: "tasks",
		taskId: crypto.randomUUID(),
		filter: "all",
		scope: "everyone",
	};
	const workspaces = [{ id: "workspace-one", name: "Product", role: "owner" }];
	await adapter.initialize({ workspaces, target });
	expect(f.frame.src).toBe(src);
	expect(f.messages.at(-1)).toMatchObject({
		type: "haunter/workspace/navigate",
		target,
	});
	await expect(
		adapter.initialize({
			workspaces,
			target: { ...target, workspaceId: "other" },
		}),
	).rejects.toThrow("Unauthorized");
	expect(f.calls).toEqual([]);
});

test("task context follows the current view and host dismissal survives task field changes", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	const taskId = crypto.randomUUID();
	const selectedTask = {
		taskId,
		pageId: null,
		sourceBlockId: null,
		title: "Plan launch",
		completed: false,
		assigneeId: null,
		dueDate: null,
		dueTime: null,
		reminderOffsetMinutes: null,
	};
	const view = {
		workspaceId: "workspace-one",
		workspaceName: "Product",
		pageId: null,
		section: "tasks",
		title: "Tasks",
		url: "https://haunter.test/w/workspace-one/tasks?filter=all",
		source: "Haunter",
		editorStatus: "ready",
		saveStatus: "saved",
		tasks: {
			lists: [
				{
					view: "tasks",
					filter: "all",
					scope: "everyone",
					visibleTaskIds: [taskId],
					hasMore: false,
					status: "ready",
				},
			],
			selectedTask,
			saveStatus: "saved",
		},
	};
	const emit = (next: unknown) =>
		f.emit({ type: "haunter/workspace/view", view: next });
	emit({
		...view,
		url: "https://haunter.test/w/workspace-one/tasks?next=https://other.test",
	});
	emit({ ...view, pageId: childId });
	expect(f.contexts).toHaveLength(0);
	emit(view);
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.tasks?.selectedTask
				?.taskId,
		).toBe(taskId),
	);
	expect(f.contexts.at(-1)?.content[0].text).toContain("latest saved task");
	adapter.syncContext(null);
	emit({
		...view,
		tasks: {
			...view.tasks,
			selectedTask: { ...selectedTask, dueDate: "2026-10-05" },
		},
		saveStatus: "unsaved",
	});
	await waitFor(() =>
		expect(f.contexts.at(-1)?.structuredContent.haunterView?.saveStatus).toBe(
			"unsaved",
		),
	);
	expect(
		f.contexts.at(-1)?.structuredContent.haunterView?.tasks?.selectedTask,
	).toBeUndefined();
	const otherId = crypto.randomUUID();
	emit({
		...view,
		tasks: {
			...view.tasks,
			selectedTask: { ...selectedTask, taskId: otherId },
		},
	});
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.tasks?.selectedTask
				?.taskId,
		).toBe(otherId),
	);
	emit({
		...view,
		section: "home",
		title: "Home",
		url: "https://haunter.test/w/workspace-one/home",
		tasks: { lists: [], saveStatus: "unknown" },
	});
	await waitFor(() =>
		expect(f.contexts.at(-1)?.structuredContent.haunterView?.section).toBe(
			"home",
		),
	);
	expect(
		f.contexts.at(-1)?.structuredContent.haunterView?.tasks?.selectedTask,
	).toBeUndefined();
});

function pageView() {
	const output = destination();
	return {
		workspaceId: output.workspaceId,
		workspaceName: "Product",
		pageId: output.pageId,
		title: output.title,
		url: output.webUrl,
		source: "Haunter",
		editorStatus: "ready",
		saveStatus: "saved",
	};
}

test("only the workspace frame, server origin, and nonce can publish context or enable messages", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	adapter.applyTheme("dark");
	const view = {
		...pageView(),
		selection: { text: "Selected passage", complete: true },
	};
	for (const overrides of [
		{ origin: "https://other.test" },
		{ source: window },
	]) {
		f.emit({ type: "haunter/workspace/ready" }, overrides);
		f.emit({ type: "haunter/workspace/view", view }, overrides);
	}
	f.emit({ type: "haunter/workspace/ready", nonce: "stale" });
	f.emit({ type: "haunter/workspace/view", nonce: "stale", view });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.messages).toEqual([]);
	expect(f.contexts).toEqual([]);
	f.emit({ type: "haunter/workspace/ready" });
	expect(f.messages.at(-1)).toMatchObject({
		type: "haunter/workspace/theme",
		theme: "dark",
	});
	f.emit({ type: "haunter/workspace/view", view });
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.selection?.text,
		).toBe("Selected passage"),
	);
	expect(f.calls).toEqual([]);
});

test("navigation before readiness sends only the latest destination and keeps the workspace mounted", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	const src = f.frame.src;
	await adapter.initialize(destination(childId));
	await adapter.initialize(canvasDestination);
	adapter.applyTheme("dark");
	expect(f.messages).toEqual([]);
	f.emit({ type: "haunter/workspace/ready" });
	expect(f.messages).toEqual([
		expect.objectContaining({ type: "haunter/workspace/theme", theme: "dark" }),
		expect.objectContaining({
			type: "haunter/workspace/navigate",
			target: { workspaceId: "workspace-one", canvasId },
		}),
	]);
	expect(f.frame.src).toBe(src);
	expect(f.calls).toEqual([]);
});

test("inline and standalone canvas selections reach context without reading page or canvas content", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	const source = f.frame.src;
	const selection = {
		canvasPageId: "page:one",
		selectedShapeIds: ["shape:box"],
		selectionCount: 1,
		selectionComplete: true,
	};
	f.emit({
		type: "haunter/workspace/view",
		view: { ...pageView(), inlineCanvas: { canvasId, selection } },
	});
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.inlineCanvas,
		).toEqual({ canvasId, selection }),
	);
	f.emit({
		type: "haunter/workspace/view",
		view: {
			...pageView(),
			pageId: null,
			canvasId,
			url: canvasDestination.webUrl,
			canvas: selection,
		},
	});
	await waitFor(() =>
		expect(f.contexts.at(-1)?.structuredContent.haunterView?.canvas).toEqual(
			selection,
		),
	);
	expect(f.contexts.at(-1)?.content[0].text).toContain("read_canvas");
	f.emit({ type: "haunter/workspace/view", view: pageView() });
	await waitFor(() =>
		expect(
			f.contexts.at(-1)?.structuredContent.haunterView?.canvas,
		).toBeUndefined(),
	);
	expect(f.frame.src).toBe(source);
	expect(f.calls).toEqual([]);
});

test("teardown requires local and server saves, ignores stale receipts and late view events", async () => {
	const f = fixture();
	await adapter.initialize(destination());
	f.emit({ type: "haunter/workspace/ready" });
	f.emit({ type: "haunter/workspace/view", view: pageView() });
	await waitFor(() => expect(f.contexts).toHaveLength(1));
	f.setSave({ locallySaved: false });
	await expect(adapter.prepareClose()).rejects.toThrow("unsaved");
	const oldReceipt = f.messages.find(
		(message) => message.type === "haunter/editor/flush",
	)!;
	expect(f.contexts.at(-1)?.structuredContent.haunterView?.pageId).toBe(
		destination().pageId,
	);
	f.setSave({ autoFlush: false });
	let closed = false;
	const closing = adapter.prepareClose().then(() => {
		closed = true;
	});
	const requestId = f.messages.at(-1)?.requestId;
	f.emit({
		type: "haunter/editor/flushed",
		requestId: oldReceipt.requestId,
		locallySaved: true,
		saved: true,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(closed).toBeFalse();
	f.emit({
		type: "haunter/editor/flushed",
		requestId,
		locallySaved: true,
		saved: true,
	});
	await closing;
	f.emit({ type: "haunter/workspace/view", view: pageView() });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.contexts.at(-1)?.structuredContent.haunterView).toBeNull();
});

test("unsupported context hosts still mount the workspace and external links stay scoped to Haunter", async () => {
	const f = fixture(undefined, { canUseContext: () => false });
	await adapter.initialize(destination());
	f.emit({ type: "haunter/workspace/view", view: pageView() });
	f.emit({ type: "haunter/workspace/open-web", path: "https://other.test/" });
	f.emit({ type: "haunter/workspace/open-web", path: "/settings" });
	f.emit({
		type: "haunter/workspace/open-web",
		path: new URL(destination().webUrl).pathname,
	});
	await waitFor(() => expect(f.links).toEqual([destination().webUrl]));
	expect(f.contexts).toEqual([]);
	expect(f.frame.hidden).toBeFalse();
});
