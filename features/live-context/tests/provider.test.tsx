import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	SessionRecovery,
	installSessionRecovery,
} from "@/client/session-recovery";
import type { PublishContextInput } from "../schemas";
import type { LiveContextTracker } from "../client/tracker";
import { act, useEffect } from "react";
import { textEditingFixture, pageSelectionFixture } from "./helpers";

const pageId = crypto.randomUUID();
const canvasId = crypto.randomUUID();
let pathname = "/w/workspace/p/" + pageId;
mock.module("next/navigation", () => ({
	usePathname: () => pathname,
	useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
}));
const { LiveContextProvider, useLiveContext } = await import(
	"../client/provider"
);
let tracker: LiveContextTracker | null = null;
function Probe() {
	tracker = useLiveContext();
	return (
		<>
			<button type="button">Page text</button>
			<div data-live-context-page={pageId}>
				<p>Editor paragraph</p>
				<input aria-label="Block input" />
				<div contentEditable={false} data-live-context-selectable="">
					<hr />
					<button type="button">Block control</button>
					<div data-live-context-canvas={canvasId}>
						<button type="button">Canvas</button>
					</div>
				</div>
			</div>
		</>
	);
}
let uninstall: () => void;
let fetchMock: ReturnType<typeof spyOn>;
let calls: PublishContextInput[];
beforeEach(() => {
	installTestDom();
	pathname = "/w/workspace/p/" + pageId;
	calls = [];
	uninstall = installSessionRecovery(
		new SessionRecovery(
			"user",
			async () => ({
				userId: "user",
				workspaceId: "workspace",
				role: "member",
			}),
			{ workspaceId: "workspace", role: "member" },
		),
	);
	fetchMock = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_input: unknown, init?: RequestInit) => {
				calls.push(JSON.parse(init?.body as string));
				return Response.json({ accepted: true });
			},
			{ preconnect: fetch.preconnect },
		),
	);
});
afterEach(async () => {
	cleanup();
	uninstall();
	fetchMock.mockRestore();
	await uninstallTestDom();
});

test("real browser events retain selection on window blur but clear it on page interaction", async () => {
	const view = render(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.length).toBeGreaterThan(0));
	act(() =>
		tracker!.canvas(
			"workspace",
			pageId,
			{
				canvasId,
				canvasPageId: "page:one",
				selectedShapeIds: ["shape:a"],
				selectionCount: 1,
				textEditing: textEditingFixture,
			},
			true,
		),
	);
	await waitFor(() =>
		expect(calls.at(-1)?.view?.canvas?.selectedShapeIds).toEqual(["shape:a"]),
	);
	fireEvent.blur(window);
	await act(async () => {
		await tracker!.flush();
	});
	expect(calls.at(-1)?.view?.canvas?.selectedShapeIds).toEqual(["shape:a"]);
	expect(calls.at(-1)?.view?.canvas?.textEditing).toEqual(textEditingFixture);
	fireEvent.pointerDown(view.getByText("Canvas"));
	await act(async () => {
		await tracker!.flush();
	});
	expect(calls.at(-1)?.view?.canvas?.selectedShapeIds).toEqual(["shape:a"]);
	fireEvent.pointerDown(view.getByText("Page text"));
	await waitFor(() => expect(calls.at(-1)?.view?.canvas).toBeNull());
});

test("navigation publishes the new page and leaving the workspace withdraws context", async () => {
	const view = render(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.length).toBeGreaterThan(0));
	const nextPage = crypto.randomUUID();
	pathname = "/w/workspace/p/" + nextPage;
	view.rerender(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.at(-1)?.view?.pageId).toBe(nextPage));
	pathname = "/settings";
	view.rerender(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.at(-1)?.view).toBeNull());
	expect(tracker).toBeNull();
});

test("page context survives blur and editor interaction but clears for nested canvases, inputs and outside UI", async () => {
	const view = render(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.length).toBeGreaterThan(0));
	for (const event of ["pointerDown", "focusIn"] as const) {
		for (const target of [
			"Canvas",
			"Page text",
			"Block input",
			"Block control",
		]) {
			tracker!.page("workspace", pageId, pageSelectionFixture, true);
			await tracker!.flush();
			fireEvent.blur(window);
			fireEvent[event](view.getByText("Editor paragraph"));
			fireEvent[event](view.getByRole("separator"));
			await tracker!.flush();
			expect(calls.at(-1)?.view?.pageSelection).toEqual(pageSelectionFixture);
			fireEvent[event](
				target === "Block input"
					? view.getByLabelText(target)
					: view.getByText(target),
			);
			tracker!.page("workspace", pageId, pageSelectionFixture, false);
			await tracker!.flush();
			expect(calls.at(-1)?.view?.pageSelection).toBeNull();
		}
	}
});

test("the first report waits for the parent session effect instead of disappearing until the next heartbeat", async () => {
	uninstall();
	function Parent() {
		useEffect(
			() =>
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
			[],
		);
		return (
			<LiveContextProvider userId="user" activeWorkspaceId="workspace">
				<Probe />
			</LiveContextProvider>
		);
	}
	render(<Parent />);
	await waitFor(() => expect(calls.at(-1)?.view?.pageId).toBe(pageId));
});

test("continuous caret motion is bounded and a range selection advances its deadline", async () => {
	render(
		<LiveContextProvider userId="user" activeWorkspaceId="workspace">
			<Probe />
		</LiveContextProvider>,
	);
	await waitFor(() => expect(calls.length).toBeGreaterThan(0));
	const caret = (position: number) => ({
		activeBlockId: "paragraph",
		selectedBlockIds: [],
		selectionCount: 0,
		selection: {
			coordinateSystem: "prosemirror" as const,
			kind: "text" as const,
			anchor: position,
			head: position,
			from: position,
			to: position,
			selectedText: "",
			truncated: false,
		},
	});
	tracker!.page("workspace", pageId, caret(1), true);
	await waitFor(() =>
		expect(calls.at(-1)?.view?.pageSelection).toEqual(caret(1)),
	);
	const before = calls.length;
	tracker!.page("workspace", pageId, caret(2), false);
	await new Promise((resolve) => setTimeout(resolve, 350));
	expect(calls).toHaveLength(before);
	// Changing every 40 ms cannot keep pushing the deadline into the future.
	let position = 2;
	const stream = setInterval(
		() => tracker!.page("workspace", pageId, caret(++position), false),
		40,
	);
	try {
		await waitFor(() => expect(calls.length).toBe(before + 1), {
			timeout: 1_200,
		});
		expect(calls.at(-1)?.view?.pageSelection?.selection?.head).toBeGreaterThan(
			2,
		);
	} finally {
		clearInterval(stream);
	}
	tracker!.page("workspace", pageId, caret(++position), false);
	tracker!.page("workspace", pageId, pageSelectionFixture, false);
	// A text range should not wait for the slower caret deadline.
	await waitFor(
		() =>
			expect(calls.at(-1)?.view?.pageSelection).toEqual(pageSelectionFixture),
		{ timeout: 700 },
	);
	tracker!.page("workspace", pageId, caret(++position), false);
	tracker!.withdraw();
	await tracker!.flush();
	await new Promise((resolve) => setTimeout(resolve, 1_050));
	expect(calls.at(-1)?.view).toBeNull();
}, 6_000);
