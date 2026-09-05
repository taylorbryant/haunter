import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	mock,
	test,
} from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { DurableDraftStorageProvider } from "@/client/durable-draft-storage-provider";
import type { DurableDraftStorage } from "@/client/durable-drafts";
import type { LocalDraft } from "@/client/local-drafts";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

const page = {
	id: "00000000-0000-4000-8000-000000000001",
	userId: "user_1",
	workspaceId: "workspace_1",
	parentPageId: null,
	title: "Server title",
	icon: null,
	position: 0,
	deletedAt: null,
	createdAt: "2026-09-03T00:00:00.000Z",
	updatedAt: "2026-09-03T00:00:00.000Z",
	contentUpdatedAt: "2026-09-03T00:00:00.000Z",
	content: [],
};

let storedDraft: LocalDraft<string> | null = null;
const draftWrites: Array<LocalDraft<string>> = [];
const titleUpdates: Array<{
	path: { id: string };
	body: { title: string; baseTitle?: string };
}> = [];

mock.module("next/dynamic", () => ({
	default: () => () => null,
}));

mock.module("@tanstack/react-query", () => ({
	useQueryClient: () => ({}),
	useQuery: () => ({ data: page, isPending: false }),
	useMutation: (options: { testKind?: string }) =>
		options.testKind === "update-title"
			? {
					isPending: false,
					mutateAsync: async (input: (typeof titleUpdates)[number]) => {
						titleUpdates.push(input);
						return {
							...page,
							title: input.body.title,
							updatedAt: "2026-09-03T00:00:01.000Z",
						};
					},
				}
			: {
					isPending: false,
					mutateAsync: async () => ({
						lastViewedAt: "2026-09-03T00:00:00.000Z",
					}),
				},
}));

mock.module("@/components/app-session-provider", () => ({
	useCurrentUser: () => ({
		id: "user_1",
		name: "Taylor",
		email: "taylor@example.com",
		image: null,
	}),
}));

mock.module("@/features/members/client/use-workspace-role", () => ({
	useCanEditWorkspace: () => true,
}));

mock.module("@/features/pages/client/queries", () => ({
	getPageQueryOptions: () => ({}),
	invalidatePage: () => Promise.resolve(),
	invalidatePages: () => Promise.resolve(),
	recordPageViewMutationOptions: () => ({ testKind: "record-view" }),
	setPageTitleInCache: (
		_queryClient: unknown,
		_pageId: string,
		title: string,
	) => {
		page.title = title;
	},
	syncRecordedPageViewInNavigationCache: () => {},
	updatePageMutationOptions: () => ({ testKind: "update-title" }),
}));

const storage: DurableDraftStorage<string> = {
	load: async () => storedDraft,
	persist: async (draft) => {
		draftWrites.push(draft);
		storedDraft = draft;
	},
	discard: async () => {
		storedDraft = null;
	},
	acknowledge: async (_key, savedWriteId, serverVersion) => {
		if (!storedDraft) return null;
		if (storedDraft.writeId === savedWriteId) {
			storedDraft = null;
			return null;
		}
		storedDraft = { ...storedDraft, baseVersion: serverVersion };
		return storedDraft;
	},
};

mock.module("../components/editor/haunter-editor", () => ({
	default: () => null,
}));
mock.module("../components/backlinks", () => ({ Backlinks: () => null }));
mock.module("../components/page-icon-picker", () => ({
	PageIconButton: () => null,
}));
mock.module("../components/page-editor-skeleton", () => ({
	EditorBodySkeleton: () => null,
	PageEditorSkeleton: () => null,
}));

let PageEditor: ComponentType<{ pageId: string }>;

function renderPageEditor() {
	return render(
		<DurableDraftStorageProvider
			storage={storage as DurableDraftStorage<unknown>}
		>
			<PageEditor pageId={page.id} />
		</DurableDraftStorageProvider>,
	);
}

beforeAll(async () => {
	installTestDom();
	PageEditor = (await import("../components/page-editor")).PageEditor;
});

beforeEach(() => {
	page.title = "Server title";
	storedDraft = null;
	draftWrites.length = 0;
	titleUpdates.length = 0;
});

afterEach(async () => {
	await act(async () => {
		cleanup();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

afterAll(uninstallTestDom);

test("stores each title locally before its debounced server save", async () => {
	const user = userEvent.setup({ document });
	const view = renderPageEditor();
	const titleInput = view.getByRole("textbox", { name: "Page title" });
	await waitFor(() => {
		expect((titleInput as HTMLTextAreaElement).readOnly).toBe(false);
	});
	await user.clear(titleInput);
	await user.type(titleInput, "A sentence worth keeping");
	expect((titleInput as HTMLTextAreaElement).value).toBe(
		"A sentence worth keeping",
	);

	await waitFor(() => {
		expect(draftWrites.at(-1)).toMatchObject({
			userId: "user_1",
			workspaceId: "workspace_1",
			resourceType: "page-title",
			resourceId: page.id,
			payload: "A sentence worth keeping",
			status: "unsaved",
		});
	});
});

test("flushes a title safely when the editor unmounts before the debounce", async () => {
	const user = userEvent.setup({ document });
	const first = renderPageEditor();
	const input = first.getByRole("textbox", { name: "Page title" });
	await waitFor(() => {
		expect((input as HTMLTextAreaElement).readOnly).toBe(false);
	});
	await user.clear(input);
	await user.type(input, "Survives navigation");
	await waitFor(() => {
		expect(draftWrites.at(-1)?.payload).toBe("Survives navigation");
	});
	await act(async () => {
		first.unmount();
		await waitFor(() => {
			expect(titleUpdates).toHaveLength(1);
		});
	});

	await waitFor(() => {
		expect(titleUpdates).toContainEqual({
			path: { id: page.id },
			body: { title: "Survives navigation", baseTitle: "Server title" },
		});
	});
	expect(storedDraft).toBeNull();

	const remounted = renderPageEditor();
	await waitFor(() => {
		const remountedInput = remounted.getByRole("textbox", {
			name: "Page title",
		}) as HTMLTextAreaElement;
		expect(remountedInput.value).toBe("Survives navigation");
		expect(remountedInput.readOnly).toBe(false);
	});
});

test("restores and syncs a same-version title draft after remount", async () => {
	storedDraft = {
		key: JSON.stringify(["user_1", "page-title", page.id]),
		userId: "user_1",
		workspaceId: "workspace_1",
		resourceType: "page-title",
		resourceId: page.id,
		baseVersion: page.updatedAt,
		payload: "Recovered after reload",
		status: "unsaved",
		updatedAt: "2026-09-03T00:00:00.000Z",
	};

	renderPageEditor();

	await waitFor(() => {
		expect(titleUpdates).toContainEqual({
			path: { id: page.id },
			body: { title: "Recovered after reload", baseTitle: "Server title" },
		});
	});
	expect(storedDraft).toBeNull();
});

test("requires confirmation before a recovered title replaces a newer title", async () => {
	storedDraft = {
		key: JSON.stringify(["user_1", "page-title", page.id]),
		userId: "user_1",
		workspaceId: "workspace_1",
		resourceType: "page-title",
		resourceId: page.id,
		baseVersion: "2026-09-02T23:59:59.000Z",
		payload: "Recovered older title",
		status: "unsaved",
		updatedAt: "2026-09-03T00:00:00.000Z",
	};
	const user = userEvent.setup({ document });
	const view = renderPageEditor();

	const keepButton = await view.findByRole("button", {
		name: "Keep my title",
	});
	expect(titleUpdates).toEqual([]);
	expect(view.getByText(/latest title is “Server title”/)).not.toBeNull();

	await user.click(keepButton);
	await waitFor(() => {
		expect(titleUpdates).toContainEqual({
			path: { id: page.id },
			body: { title: "Recovered older title", baseTitle: "Server title" },
		});
	});
	expect(storedDraft).toBeNull();
});
