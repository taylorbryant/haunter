import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { createWorkspaceAdapter } from "../mcp-app/workspace-adapter";
import type { ContextSnapshot } from "../mcp-app/model-context";
import { destination, childId } from "./mcp-app-fixture";

let adapter: ReturnType<typeof createWorkspaceAdapter>;
beforeEach(() => {
	installTestDom();
	document.documentElement.dataset.appOrigin = "https://haunter.test";
	document.body.innerHTML =
		'<p id="connection-status"></p><iframe id="real-editor"></iframe>';
});
afterEach(async () => {
	adapter?.dispose();
	await uninstallTestDom();
});

function fixture(toolError?: Error) {
	const calls: string[] = [];
	const contexts: ContextSnapshot[] = [];
	const messages: Record<string, unknown>[] = [];
	const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
	const frameWindow = frame.contentWindow;
	let src = "about:blank";
	let saved = true;
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
			if (message.type === "haunter/editor/flush")
				queueMicrotask(() =>
					emit({
						type: "haunter/editor/flushed",
						requestId: message.requestId,
						saved,
						locallySaved: true,
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
		async openLink() {},
		canUseContext: () => true,
		async setContext(snapshot) {
			contexts.push(snapshot);
		},
	});
	return {
		calls,
		contexts,
		messages,
		frame,
		emit,
		failSave() {
			saved = false;
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
	f.failSave();
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
