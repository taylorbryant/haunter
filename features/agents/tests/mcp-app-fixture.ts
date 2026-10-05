import { waitFor } from "@testing-library/react";
import { createCompanion, type CompanionBridge } from "../mcp-app/controller";
import type { ContextPage } from "../mcp-app/schemas";
import type {
	ContextSnapshot,
	CurrentPageContext,
} from "../mcp-app/model-context";

export const template = await Bun.file(
	new URL("../mcp-app/index.html", import.meta.url),
).text();
export const pageId = "17c05b44-c652-4d83-92cf-83cbf7056ef2";
export const childId = "181e57bb-d220-4022-b4d6-8cd96f55ba28";
export const workspaces = [
	{ id: "workspace-one", name: "Product", role: "owner" },
	{ id: "workspace-two", name: "Team", role: "owner" },
];
export const savedPage = {
	pageId,
	title: "Launch plan",
	markdown: "Prepare **release notes**.",
	revision: "revision-one",
	updatedAt: "2026-09-30T12:00:00Z",
};
export const child = {
	...savedPage,
	pageId: childId,
	title: "Release checklist",
	parentPageId: pageId,
};
export const destination = (id = pageId, workspaceId = "workspace-one") => ({
	workspaceId,
	pageId: id,
	title: id === pageId ? savedPage.title : child.title,
	editorUrl: `https://haunter.test/embed/w/${workspaceId}/p/${id}`,
	webUrl: `https://haunter.test/w/${workspaceId}/p/${id}`,
});
export const element = <T extends HTMLElement = HTMLButtonElement>(
	id: string,
) => document.getElementById(id) as T;
export function fixture(overrides: Partial<CompanionBridge> = {}) {
	const contexts: Array<
		ContextSnapshot & {
			text: string;
			page?: ContextPage;
			view?: CurrentPageContext;
		}
	> = [];
	const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
	const links: string[] = [];
	const messages: Array<Record<string, unknown>> = [];
	const frame = element<HTMLIFrameElement>("real-editor");
	const frameWindow = frame.contentWindow;
	let source = "about:blank";
	const settings = {
		autoFlush: true,
		locallySaved: true,
		saved: true,
		autoReady: true,
	};
	function emit(
		type: string,
		data: Record<string, unknown> = {},
		overrides: Partial<MessageEventInit> = {},
	) {
		window.dispatchEvent(
			new MessageEvent("message", {
				source: frameWindow,
				origin: "https://haunter.test",
				data: {
					type,
					nonce: new URL(source).searchParams.get("nonce"),
					...data,
				},
				...overrides,
			}),
		);
	}
	Object.defineProperty(frameWindow, "postMessage", {
		value: (data: Record<string, unknown>) => {
			messages.push(data);
			if (data.type === "haunter/editor/flush" && settings.autoFlush)
				queueMicrotask(() =>
					emit("haunter/editor/flushed", {
						requestId: data.requestId,
						locallySaved: settings.locallySaved,
						saved: settings.saved,
					}),
				);
		},
	});
	Object.defineProperty(frame, "contentWindow", { get: () => frameWindow });
	Object.defineProperty(frame, "src", {
		get: () => source,
		set: (value: string) => {
			source = value;
			if (value !== "about:blank" && settings.autoReady)
				queueMicrotask(() =>
					emit("haunter/editor/status", { status: "ready" }),
				);
		},
	});
	const defaultCall: CompanionBridge["callTool"] = async (name, args) => {
		if (name === "get_haunter_workspace")
			return {
				pages: [savedPage, child],
				canEdit: true,
				favorites: [],
				canvasFavorites: [],
				canvases: [],
			};
		if (name === "list_workspaces") return { workspaces };
		if (name === "open_haunter_editor")
			return destination(String(args.pageId), String(args.workspaceId));
		if (name === "read_page")
			return args.pageId === childId ? child : savedPage;
		if (name === "authorize_haunter_editor") return { id: "handoff" };
		return { pages: [savedPage, child] };
	};
	const companion = createCompanion({
		canUseContext: () => true,
		async setContext(snapshot) {
			contexts.push({
				...snapshot,
				text: snapshot.content.map((item) => item.text).join("\n\n"),
				page: snapshot.structuredContent.haunterPage ?? undefined,
				view: snapshot.structuredContent.haunterView ?? undefined,
			});
			return { updateId: `update-${contexts.length}` };
		},
		async openLink(url) {
			links.push(url);
		},
		...overrides,
		async callTool(name, args) {
			calls.push({ name, args });
			return (overrides.callTool ?? defaultCall)(name, args);
		},
	});
	async function open(id = pageId) {
		await companion.initialize(destination(id));
		await waitFor(() => {
			if (element<HTMLButtonElement>("home").disabled) throw new Error("Busy");
		});
	}
	function clickPage(id: string) {
		document
			.querySelector<HTMLButtonElement>(`.page-link[data-page-id="${id}"]`)
			?.click();
	}
	return {
		companion,
		frame,
		contexts,
		calls,
		messages,
		links,
		emit,
		settings,
		open,
		clickPage,
		defaultCall,
	};
}
