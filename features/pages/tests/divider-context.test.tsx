import {
	afterAll,
	afterEach,
	beforeAll,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { act, useEffect } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	SessionRecovery,
	installSessionRecovery,
} from "@/client/session-recovery";
import {
	PublishContextInputSchema,
	type PublishContextInput,
} from "@/features/live-context/schemas";
import { observePageContext } from "../client/live-context";

const pageId = crypto.randomUUID();
mock.module("next/navigation", () => ({
	usePathname: () => `/w/workspace/p/${pageId}`,
}));
const { LiveContextProvider, useLiveContext } = await import(
	"@/features/live-context/client/provider"
);
let BlockNoteView: typeof import("@blocknote/shadcn").BlockNoteView;
const dispose: (() => void)[] = [];

beforeAll(async () => {
	installTestDom();
	const view = await import("prosemirror-view");
	mock.module("@tiptap/pm/view", () => view);
	({ BlockNoteView } = await import("@blocknote/shadcn"));
});
afterEach(() => {
	cleanup();
	for (const stop of dispose.splice(0)) stop();
});
afterAll(uninstallTestDom);

test("clicking a divider reports its node selection and continues reporting caret movement and typing", async () => {
	const calls: PublishContextInput[] = [];
	const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_input: unknown, init?: RequestInit) => {
				calls.push(
					PublishContextInputSchema.parse(JSON.parse(init?.body as string)),
				);
				return Response.json({ accepted: true });
			},
			{ preconnect: fetch.preconnect },
		),
	);
	dispose.push(() => fetchMock.mockRestore());
	dispose.push(
		installSessionRecovery(
			new SessionRecovery(
				"user",
				async () => ({
					userId: "user",
					workspaceId: "workspace",
					role: "member",
				}),
				{ workspaceId: "workspace", role: "member" },
			),
		),
	);
	const { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } = await import(
		"@blocknote/core"
	);
	const { dividerBlockSpec } = await import(
		"../components/editor/divider-block"
	);
	const schema = BlockNoteSchema.create({
		blockSpecs: { ...defaultBlockSpecs, divider: dividerBlockSpec() },
	});
	const editor = BlockNoteEditor.create({
		schema,
		initialContent: [
			{ id: "before", type: "paragraph", content: "Before" },
			{ id: "divider", type: "divider" },
			{ id: "after", type: "paragraph", content: "After" },
		],
	});
	dispose.push(() => editor._tiptapEditor.destroy());
	function Body() {
		const tracker = useLiveContext();
		useEffect(() => {
			if (tracker)
				return observePageContext(editor, tracker, {
					workspaceId: "workspace",
					pageId,
				});
		}, [tracker]);
		return (
			<BlockNoteView
				editor={editor}
				formattingToolbar={false}
				sideMenu={false}
				slashMenu={false}
			/>
		);
	}
	const ui = render(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Body />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.length).toBeGreaterThan(0));
	const root = editor.domElement!;
	act(() => {
		editor.setTextCursorPosition("before", "start");
		editor.focus();
	});
	fireEvent.pointerDown(ui.getByText("Before"));
	await waitFor(() =>
		expect(calls.at(-1)?.view?.pageSelection?.activeBlockId).toBe("before"),
	);
	const originalDocument = editor.prosemirrorState.doc;
	let dividerPos = -1,
		afterPos = -1;
	originalDocument.descendants((node, pos) => {
		if (node.attrs.id === "divider") dividerPos = pos + 1;
		if (node.attrs.id === "after") afterPos = pos + 2;
	});
	expect(dividerPos).toBeGreaterThan(0);
	expect(afterPos).toBeGreaterThan(dividerPos);
	fireEvent.pointerDown(ui.getByRole("separator"));
	// Happy DOM has no hit-testing/layout. Apply the same selections generated
	// by a browser's divider click and ArrowDown, without changing DOM focus.
	act(() => {
		const { state } = editor.prosemirrorView;
		editor.prosemirrorView.dispatch(
			state.tr.setSelection(NodeSelection.create(state.doc, dividerPos)),
		);
	});
	await waitFor(() =>
		expect(calls.at(-1)?.view?.pageSelection).toEqual({
			activeBlockId: "divider",
			selectedBlockIds: ["divider"],
			selectionCount: 1,
			selection: null,
		}),
	);
	expect(document.activeElement).toBe(root);
	expect(editor.prosemirrorState.doc).toBe(originalDocument);
	act(() => {
		const { state } = editor.prosemirrorView;
		editor.prosemirrorView.dispatch(
			state.tr.setSelection(TextSelection.create(state.doc, afterPos)),
		);
	});
	await waitFor(() =>
		expect(calls.at(-1)?.view?.pageSelection).toMatchObject({
			activeBlockId: "after",
			selectedBlockIds: [],
			selection: { from: afterPos, to: afterPos },
		}),
	);
	act(() => {
		editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.insertText("q"));
	});
	await waitFor(() =>
		expect(calls.at(-1)?.view?.pageSelection?.selection).toMatchObject({
			from: afterPos + 1,
			to: afterPos + 1,
			selectedText: "",
		}),
	);
	expect(document.activeElement).toBe(root);
	expect(editor.getBlock("after")?.content).toEqual([
		{ type: "text", text: "qAfter", styles: {} },
	]);
});
