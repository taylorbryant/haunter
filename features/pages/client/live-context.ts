import type { BlockNoteEditor } from "@blocknote/core";
import type { LiveContextTracker } from "@/features/live-context/client/tracker";
import { isPageContextTarget } from "@/features/live-context/client/page-target";
import { readPageSelection } from "./selection-context";

type PageEditor = Pick<BlockNoteEditor, "domElement" | "prosemirrorState"> & {
	onChange: (callback: () => void) => () => void;
	onSelectionChange: (
		callback: () => void,
		includeRemote: boolean,
	) => () => void;
	onMount: (callback: () => void) => () => void;
	onUnmount: (callback: () => void) => () => void;
};

export function observePageContext(
	editor: PageEditor,
	tracker: LiveContextTracker,
	identity: { workspaceId: string; pageId: string },
) {
	let container: HTMLElement | undefined;
	const report = (activate: boolean) => {
		if (!container) return;
		tracker.page(
			identity.workspaceId,
			identity.pageId,
			readPageSelection(editor.prosemirrorState),
			activate,
		);
	};
	const activate = (event: Event) => {
		if (event.target instanceof Element && isPageContextTarget(event.target))
			report(true);
	};
	const detach = () => {
		container?.removeEventListener("pointerdown", activate, true);
		container?.removeEventListener("focusin", activate, true);
		container?.removeAttribute("data-live-context-page");
		container = undefined;
		tracker.clearPage(identity.pageId);
	};
	const attach = () => {
		detach();
		container = editor.domElement;
		container?.setAttribute("data-live-context-page", identity.pageId);
		container?.addEventListener("pointerdown", activate, true);
		container?.addEventListener("focusin", activate, true);
	};
	const changed = () => report(false);
	const stopChange = editor.onChange(changed);
	const stopSelection = editor.onSelectionChange(changed, true);
	const stopMount = editor.onMount(attach);
	const stopUnmount = editor.onUnmount(detach);
	attach();
	return () => {
		stopChange();
		stopSelection();
		stopMount();
		stopUnmount();
		detach();
	};
}
