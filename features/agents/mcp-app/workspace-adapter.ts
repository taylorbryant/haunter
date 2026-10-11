import type { CompanionBridge } from "./controller";
import { createCompanionContext } from "./model-context";
import { EditorOutputSchema, validateEditorOutput } from "./editor-schema";
import { OpenHaunterOutputSchema } from "./workspace-opener";
import {
	WorkspaceBridgeMessageSchema,
	workspaceTargetPath,
	parseWorkspacePath,
	type WorkspaceTarget,
} from "./workspace-bridge";

/** The MCP resource is only a host adapter. Haunter owns UI, requests and navigation. */
export function createWorkspaceAdapter(bridge: CompanionBridge) {
	const frame = document.querySelector<HTMLIFrameElement>("#real-editor")!;
	const message = document.querySelector<HTMLElement>("#connection-status")!;
	const origin = new URL(document.documentElement.dataset.appOrigin!).origin;
	const nonce = crypto.randomUUID();
	const context = createCompanionContext({ ...bridge, changed() {} });
	let mounted = false;
	let ready = false;
	let disposed = false;
	let closing = false;
	let theme: "dark" | "light" = "light";
	let pending: WorkspaceTarget | undefined;
	const flushes = new Map<string, (saved: boolean) => void>();
	const send = (data: Record<string, unknown>) => {
		if (ready && !disposed)
			frame.contentWindow?.postMessage({ ...data, nonce }, origin);
	};
	const onMessage = async (event: MessageEvent) => {
		if (
			disposed ||
			event.source !== frame.contentWindow ||
			event.origin !== origin ||
			event.data?.nonce !== nonce
		)
			return;
		const parsed = WorkspaceBridgeMessageSchema.safeParse(event.data);
		if (!parsed.success) return;
		const data = parsed.data;
		if (data.type === "haunter/workspace/authorize") {
			try {
				const handoff = await bridge.callTool("authorize_haunter_workspace", {
					workspaceId: data.workspaceId,
					challenge: data.challenge,
				});
				if (!disposed)
					frame.contentWindow?.postMessage(
						{
							type: "haunter/editor/authorized",
							nonce,
							requestId: data.requestId,
							handoff,
						},
						origin,
					);
			} catch (error) {
				if (!disposed)
					frame.contentWindow?.postMessage(
						{
							type: "haunter/editor/authorized",
							nonce,
							requestId: data.requestId,
							error: true,
							message:
								error instanceof Error
									? error.message.slice(0, 300)
									: "The host could not authorize Haunter. Try again.",
						},
						origin,
					);
			}
		} else if (data.type === "haunter/workspace/ready") {
			ready = true;
			send({ type: "haunter/workspace/theme", theme });
			if (pending) {
				send({ type: "haunter/workspace/navigate", target: pending });
				pending = undefined;
			}
		} else if (data.type === "haunter/workspace/view") {
			if (closing) return;
			if (data.view) {
				const url = new URL(data.view.url);
				parseWorkspacePath(url.pathname + url.search);
				if (url.hash) return;
				if (
					url.origin !== origin ||
					url.pathname !==
						workspaceTargetPath({
							workspaceId: data.view.workspaceId,
							...(data.view.section ? { view: data.view.section } : {}),
							...(data.view.canvasId
								? { canvasId: data.view.canvasId }
								: data.view.pageId
									? { pageId: data.view.pageId }
									: {}),
						})
				)
					return;
			}
			context.setView(data.view ?? undefined);
		} else if (data.type === "haunter/editor/flushed") {
			flushes.get(data.requestId)?.(data.locallySaved && data.saved);
		} else if (data.type === "haunter/workspace/open-web") {
			parseWorkspacePath(data.path);
			await bridge.openLink(new URL(data.path, origin).href);
		}
	};
	const listener = (event: MessageEvent) => {
		void onMessage(event).catch(() => {});
	};
	window.addEventListener("message", listener);
	async function initialize(value: unknown) {
		let target: WorkspaceTarget;
		if (EditorOutputSchema.safeParse(value).success) {
			const output = validateEditorOutput(value);
			if (new URL(output.editorUrl).origin !== origin)
				throw new Error("Unexpected Haunter server.");
			target = {
				workspaceId: output.workspaceId,
				...(output.canvasId
					? { canvasId: output.canvasId }
					: { pageId: output.pageId! }),
			};
		} else {
			const list = OpenHaunterOutputSchema.parse(value);
			if (!list.workspaces.length) {
				showConnectionError(
					"No authorized workspaces. Update the Haunter connection to continue.",
				);
				return;
			}
			if (
				list.target &&
				!list.workspaces.some((item) => item.id === list.target?.workspaceId)
			)
				throw new Error("Unauthorized workspace destination.");
			target = list.target ?? { workspaceId: list.workspaces[0].id };
		}
		if (disposed) return;
		message.hidden = true;
		if (mounted) {
			if (ready) send({ type: "haunter/workspace/navigate", target });
			else pending = target;
			return;
		}
		const url = new URL("/embed/workspace", origin);
		url.searchParams.set("path", workspaceTargetPath(target));
		url.searchParams.set(
			"parentOrigin",
			window.location.origin === "null"
				? new URL(window.location.href).protocol +
						"//" +
						new URL(window.location.href).host
				: window.location.origin,
		);
		url.searchParams.set("nonce", nonce);
		frame.src = url.href;
		frame.hidden = false;
		mounted = true;
	}
	function showConnectionError(text: string) {
		message.textContent = text;
		message.hidden = false;
	}
	return {
		initialize,
		showConnectionError,
		reload: async () => initialize(await bridge.callTool("open_haunter", {})),
		applyTheme(next: "light" | "dark") {
			theme = next;
			document.documentElement.style.colorScheme = next;
			send({ type: "haunter/workspace/theme", theme });
		},
		syncContext: context.sync,
		async prepareClose() {
			closing = true;
			if (ready) {
				const requestId = crypto.randomUUID();
				const saved = await new Promise<boolean>((resolve) => {
					const timer = setTimeout(() => {
						flushes.delete(requestId);
						resolve(false);
					}, 7000);
					flushes.set(requestId, (value) => {
						clearTimeout(timer);
						flushes.delete(requestId);
						resolve(value);
					});
					send({ type: "haunter/editor/flush", requestId, pause: true });
				});
				if (!saved) {
					closing = false;
					send({ type: "haunter/editor/resume" });
					throw new Error(
						"Haunter still has unsaved changes. Reconnect and wait for them to save before closing.",
					);
				}
			}
			try {
				await context.clearView();
			} catch (error) {
				closing = false;
				send({ type: "haunter/editor/resume" });
				throw error;
			}
		},
		dispose() {
			disposed = true;
			window.removeEventListener("message", listener);
			for (const finish of flushes.values()) finish(false);
			context.dispose();
		},
	};
}
