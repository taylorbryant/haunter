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
import { textEditingFixture } from "./helpers";

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
			<div data-live-context-canvas={canvasId}>
				<button type="button">Canvas</button>
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
