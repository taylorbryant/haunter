import {
	afterAll,
	afterEach,
	beforeAll,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ComponentType } from "react";
import { subscribeUserErrors } from "@/client/error-feedback";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { listTasksQueryOptions } from "../client/queries";
import type { TaskWithPage } from "../schemas";

mock.module("next/navigation", () => ({
	usePathname: () => "/w/workspace_1/tasks",
	useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/client/use-draft-safe-router", () => ({
	useDraftSafeRouter: () => ({ replace() {} }),
}));
mock.module("@/components/app-session-provider", () => ({
	useCurrentUser: () => ({
		id: "user_1",
		name: "Tester",
		email: "test@example.com",
	}),
}));
mock.module("@/components/create-dialog-provider", () => ({
	useCreateDialog: () => ({ openCreateTask() {} }),
}));
mock.module("@/components/device-time-provider", () => ({
	useDeviceTime: () => ({
		ready: true,
		today: "2026-09-14",
		currentTime: "12:00",
	}),
}));
mock.module("@/features/members/client/use-workspace-role", () => ({
	useCanEditWorkspace: () => true,
}));
mock.module("@/components/responsive-dialog", () => ({
	ResponsiveDialog: ({
		open,
		title,
		description,
		children,
	}: ComponentProps<
		typeof import("@/components/responsive-dialog").ResponsiveDialog
	>) =>
		open ? (
			<dialog open aria-label={String(title)}>
				{description}
				{children}
			</dialog>
		) : null,
	ResponsiveDialogFooter: ({ children }: ComponentProps<"div">) => (
		<div>{children}</div>
	),
}));
mock.module("@/components/due-date-picker", () => ({
	DueDatePicker: () => null,
}));
mock.module("@/features/members/components/assignee-picker", () => ({
	AssigneePicker: () => null,
}));
mock.module("@/features/tasks/components/task-composer", () => ({
	TaskComposer: () => null,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({
		variant: _variant,
		size: _size,
		...props
	}: ComponentProps<"button"> & {
		variant?: string;
		size?: string;
	}) => <button {...props} />,
}));

let TaskList: ComponentType<{ workspaceId: string }>;
beforeAll(async () => {
	installTestDom();
	({ TaskList } = await import("../components/task-list"));
});
afterAll(uninstallTestDom);
const cleanups: Array<() => void> = [];
afterEach(() => {
	cleanup();
	for (const clean of cleanups.splice(0).reverse()) clean();
});

const taskA: TaskWithPage = {
	id: "31cc7263-1358-47f0-88cc-a4595ff26b0e",
	userId: "user_1",
	workspaceId: "workspace_1",
	pageId: null,
	sourceBlockId: null,
	title: "Task A",
	completed: false,
	completedAt: null,
	dueDate: null,
	dueTime: null,
	reminderOffsetMinutes: null,
	assigneeId: "user_1",
	assigneeName: "Tester",
	createdAt: "2026-09-13T00:00:00.000Z",
	updatedAt: "2026-09-13T00:00:00.000Z",
	pageTitle: null,
};
const taskB = {
	...taskA,
	id: "1a6aa7dd-878c-4589-af87-f5d1eec88a3d",
	title: "Task B",
};

function titleInput(view: ReturnType<typeof render>) {
	const input = view.getByRole("textbox", { name: "Task name" });
	if (!(input instanceof HTMLInputElement))
		throw new Error("Missing title input");
	return input;
}

function setup() {
	let serverTasks = [taskA, taskB];
	const errors: string[] = [];
	cleanups.push(subscribeUserErrors((message) => errors.push(message)));
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	cleanups.push(() => queryClient.clear());
	queryClient.setQueryData(
		listTasksQueryOptions("workspace_1", "open").queryKey,
		{
			items: serverTasks,
			hasMore: false,
		},
	);
	const requests: Array<
		{
			id: string;
			response: ReturnType<typeof Promise.withResolvers<Response>>;
			settled: boolean;
		} & ({ method: "PATCH"; title: string } | { method: "DELETE" })
	> = [];
	const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PATCH" || init?.method === "DELETE") {
					const response = Promise.withResolvers<Response>();
					requests.push({
						id: String(input).split("/").at(-1) ?? "",
						response,
						settled: false,
						...(init.method === "PATCH"
							? {
									method: "PATCH" as const,
									title: JSON.parse(String(init.body)).title,
								}
							: { method: "DELETE" as const }),
					});
					return response.promise;
				}
				return Response.json({ items: serverTasks, hasMore: false });
			},
			{ preconnect: fetch.preconnect },
		),
	);
	cleanups.push(() => fetchMock.mockRestore());
	const view = render(
		<QueryClientProvider client={queryClient}>
			<TaskList workspaceId="workspace_1" />
		</QueryClientProvider>,
	);
	const user = userEvent.setup({ document: window.document });
	async function edit(title: string, draft: string) {
		await user.click(view.getByRole("button", { name: title }));
		const input = titleInput(view);
		await user.clear(input);
		await user.type(input, draft);
		return input;
	}
	async function settle(index: number, fails = false) {
		await waitFor(() => expect(requests.length).toBeGreaterThan(index));
		const request = requests[index];
		if (!request) throw new Error("Missing mutation request");
		if (!fails) {
			serverTasks =
				request.method === "DELETE"
					? serverTasks.filter((task) => task.id !== request.id)
					: serverTasks.map((task) =>
							task.id === request.id ? { ...task, title: request.title } : task,
						);
		}
		await act(async () => {
			request.settled = true;
			request.response.resolve(
				fails
					? Response.json(
							{ code: "INTERNAL_SERVER_ERROR", message: "Unavailable" },
							{ status: 500 },
						)
					: request.method === "DELETE"
						? new Response(null, { status: 204 })
						: Response.json(serverTasks.find((task) => task.id === request.id)),
			);
			await Bun.sleep(0);
		});
		await waitFor(() =>
			expect(queryClient.isMutating()).toBe(
				requests.filter((request) => !request.settled).length,
			),
		);
	}
	async function openDelete(title: string) {
		const row = view.getByRole("button", { name: title }).closest("li");
		if (!row) throw new Error("Missing task row");
		await user.click(within(row).getByRole("button", { name: "Delete task" }));
	}
	async function confirmDelete() {
		await user.click(
			within(view.getByRole("dialog")).getByRole("button", {
				name: "Delete task",
			}),
		);
	}
	return {
		view,
		user,
		edit,
		settle,
		requests,
		errors,
		openDelete,
		confirmDelete,
	};
}

test("a failed rename preserves another task's active draft and retains the failed draft for retry", async () => {
	const { view, user, edit, settle, requests } = setup();
	await edit("Task A", "Edited A");
	await user.keyboard("{Enter}");
	await waitFor(() => expect(requests).toHaveLength(1));
	const draftB = await edit("Task B", "Unsaved draft for B");
	await settle(0, true);
	expect(view.getByRole("textbox", { name: "Task name" })).toBe(draftB);
	expect(draftB.value).toBe("Unsaved draft for B");
	expect(document.activeElement).toBe(draftB);
	const rowA = view.getByRole("button", { name: "Task A" }).closest("li");
	if (!rowA) throw new Error("Missing task A row");
	expect(within(rowA).getByRole("alert").textContent).toBeTruthy();
	expect(requests).toHaveLength(1); // B's draft was not accidentally submitted.
	await user.keyboard("{Escape}");
	await user.click(view.getByRole("button", { name: "Task A" }));
	expect(titleInput(view).value).toBe("Edited A");
	await user.keyboard("{Enter}");
	await settle(1);
	expect(
		requests.map((request) =>
			request.method === "PATCH" ? request.title : undefined,
		),
	).toEqual(["Edited A", "Edited A"]);
	expect(view.queryByRole("alert")).toBeNull();
	await user.click(view.getByRole("button", { name: "Task B" }));
	expect(titleInput(view).value).toBe("Task B");
});

test("an older failure does not reopen its editor after the user submitted another task", async () => {
	const { view, user, edit, settle, requests } = setup();
	await edit("Task A", "Edited A");
	await user.keyboard("{Enter}");
	await waitFor(() => expect(requests).toHaveLength(1));
	await edit("Task B", "Edited B");
	await user.keyboard("{Enter}");
	await waitFor(() => expect(requests).toHaveLength(2));
	await settle(0, true);
	expect(view.queryByRole("textbox", { name: "Task name" })).toBeNull();
	await settle(1, true);
	expect(titleInput(view).value).toBe("Edited B");
	expect(view.getAllByRole("alert")).toHaveLength(2);
	await user.keyboard("{Escape}");
	await user.click(view.getByRole("button", { name: "Task A" }));
	expect(titleInput(view).value).toBe("Edited A");
});

test("a failed rename reopens its draft when there was no later editing interaction", async () => {
	const { view, user, edit, settle } = setup();
	await edit("Task A", "Edited A");
	await user.keyboard("{Enter}");
	await settle(0, true);
	expect(titleInput(view).value).toBe("Edited A");
	expect(view.getByRole("alert").textContent).toBeTruthy();
	await user.keyboard("{Enter}");
	await settle(1);
	await user.click(view.getByRole("button", { name: "Edited A" }));
	expect(titleInput(view).value).toBe("Edited A");
	expect(view.queryByRole("alert")).toBeNull();
});

test("an older delete failure preserves the current confirmation and its target", async () => {
	const { view, openDelete, confirmDelete, settle, requests, errors } = setup();
	await openDelete("Task A");
	await confirmDelete();
	await waitFor(() => expect(requests).toHaveLength(1));
	await openDelete("Task B");
	await settle(0, true);

	expect(view.getByRole("dialog").textContent).toContain(
		"This removes Task B permanently.",
	);
	expect(within(view.getByRole("dialog")).queryByRole("alert")).toBeNull();
	expect(view.getByRole("button", { name: "Task A" })).toBeTruthy();
	expect(errors).toEqual(["Unavailable"]);
	await confirmDelete();
	await settle(1);
	expect(requests.map(({ method, id }) => ({ method, id }))).toEqual([
		{ method: "DELETE", id: taskA.id },
		{ method: "DELETE", id: taskB.id },
	]);
	expect(view.queryByRole("button", { name: "Task B" })).toBeNull();
	expect(view.queryByRole("dialog")).toBeNull();
});

test("an older delete failure does not reopen a dialog after a newer confirmation was canceled", async () => {
	const { view, user, openDelete, confirmDelete, settle, requests, errors } =
		setup();
	await openDelete("Task A");
	await confirmDelete();
	await waitFor(() => expect(requests).toHaveLength(1));
	await openDelete("Task B");
	await user.click(view.getByRole("button", { name: "Cancel" }));
	await settle(0, true);

	expect(view.queryByRole("dialog")).toBeNull();
	expect(errors).toEqual(["Unavailable"]);
	expect(requests).toHaveLength(1);
	expect(view.getByRole("button", { name: "Task A" })).toBeTruthy();
	expect(view.getByRole("button", { name: "Task B" })).toBeTruthy();
});

test("delete failures arriving out of order preserve the latest task's retry dialog", async () => {
	const { view, openDelete, confirmDelete, settle, requests, errors } = setup();
	await openDelete("Task A");
	await confirmDelete();
	await waitFor(() => expect(requests).toHaveLength(1));
	await openDelete("Task B");
	await confirmDelete();
	await settle(1, true);
	await settle(0, true);

	expect(view.getByRole("dialog").textContent).toContain(
		"This removes Task B permanently.",
	);
	expect(
		within(view.getByRole("dialog")).getByRole("alert").textContent,
	).toBeTruthy();
	expect(errors).toEqual(["Unavailable"]);
	await confirmDelete();
	await settle(2);
	expect(requests.map(({ id }) => id)).toEqual([taskA.id, taskB.id, taskB.id]);
	expect(view.getByRole("button", { name: "Task A" })).toBeTruthy();
});

test("a delete failure reopens its confirmation for retry when there was no later interaction", async () => {
	const { view, openDelete, confirmDelete, settle, requests, errors } = setup();
	await openDelete("Task A");
	await confirmDelete();
	await settle(0, true);

	expect(view.getByRole("dialog").textContent).toContain(
		"This removes Task A permanently.",
	);
	expect(
		within(view.getByRole("dialog")).getByRole("alert").textContent,
	).toBeTruthy();
	expect(errors).toHaveLength(0);
	await confirmDelete();
	await settle(1);
	expect(requests.map(({ id }) => id)).toEqual([taskA.id, taskA.id]);
	expect(view.queryByRole("button", { name: "Task A" })).toBeNull();
	expect(view.queryByRole("dialog")).toBeNull();
});
