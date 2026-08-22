"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2Icon, ListTodoIcon, ShapesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
	createContext,
	type FormEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useCurrentUser } from "@/components/app-session-provider";
import { useCommand } from "@/components/command-palette/registry";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSidebar } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import {
	createCanvasMutationOptions,
	invalidateCanvases,
} from "@/features/canvases/client/queries";
import { CANVAS_TITLE_MAX_LENGTH } from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	createPageMutationOptions,
	invalidatePageNavigation,
	invalidatePages,
} from "@/features/pages/client/queries";
import type { BlockJson } from "@/features/pages/schemas";
import { PAGE_TITLE_MAX_LENGTH } from "@/features/pages/schemas";
import {
	createTaskMutationOptions,
	invalidateTasks,
} from "@/features/tasks/client/queries";
import {
	TaskComposer,
	type TaskSubmissionResult,
} from "@/features/tasks/components/task-composer";
import type { TaskReminderOffsetMinutes } from "@/features/tasks/lib/reminder-options";

const PAGE_DETAILS_MAX_LENGTH = 20_000;

type CreateDialogContextValue = {
	openCreateCanvas: () => void;
	openCreatePage: () => void;
	openCreateTask: () => void;
};

const CreateDialogContext = createContext<CreateDialogContextValue | null>(
	null,
);

export function useCreateDialog() {
	const context = useContext(CreateDialogContext);
	if (!context) {
		throw new Error("useCreateDialog must be used within CreateDialogProvider");
	}
	return context;
}

function pageDetailsContent(details: string): BlockJson[] {
	return details
		.trim()
		.split(/\r?\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph) => ({
			id: crypto.randomUUID(),
			type: "paragraph",
			props: {
				backgroundColor: "default",
				textColor: "default",
				textAlignment: "left",
			},
			content: [{ type: "text", text: paragraph, styles: {} }],
			children: [],
		}));
}

function CreatePageDialog({
	open,
	onOpenChange,
	onPendingChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPendingChange: (pending: boolean) => void;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const mutation = useMutation({
		...createPageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [title, setTitle] = useState("");
	const [details, setDetails] = useState("");
	const [error, setError] = useState<string | null>(null);
	const normalizedTitle = title.trim();

	useEffect(() => {
		if (!open) return;
		setTitle("");
		setDetails("");
		setError(null);
	}, [open]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!normalizedTitle || mutation.isPending) return;
		setError(null);
		onPendingChange(true);

		try {
			const initialContent = pageDetailsContent(details);
			const page = await mutation.mutateAsync({
				body: {
					workspaceId,
					title: normalizedTitle,
					...(initialContent.length > 0 ? { initialContent } : {}),
				},
			});
			void Promise.all([
				invalidatePages(queryClient),
				invalidatePageNavigation(queryClient, workspaceId),
			]).catch(() => undefined);
			onOpenChange(false);
			router.push(`/w/${workspaceId}/p/${page.id}`);
		} catch (createError) {
			setError(
				contractErrorMessage(
					createError,
					"The page could not be created. Try again.",
				),
			);
		} finally {
			onPendingChange(false);
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(next) => {
				if (!mutation.isPending) onOpenChange(next);
			}}
			title="Create page"
			description="Add a new top-level page to this workspace."
			className="sm:max-w-md"
		>
			<form className="flex flex-col gap-5" onSubmit={submit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="create-page-title">Title</Label>
					<Input
						id="create-page-title"
						name="title"
						autoFocus
						autoComplete="off"
						maxLength={PAGE_TITLE_MAX_LENGTH}
						value={title}
						placeholder="Page title"
						aria-invalid={Boolean(error)}
						aria-describedby={error ? "create-page-error" : undefined}
						onChange={(event) => {
							setTitle(event.target.value);
							if (error) setError(null);
						}}
					/>
					{error ? (
						<p
							id="create-page-error"
							role="alert"
							className="text-destructive text-sm"
						>
							{error}
						</p>
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="create-page-details">
						Details{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</Label>
					<Textarea
						id="create-page-details"
						name="details"
						value={details}
						maxLength={PAGE_DETAILS_MAX_LENGTH}
						placeholder="Add a little more context…"
						className="min-h-28 resize-none"
						onChange={(event) => setDetails(event.target.value)}
					/>
				</div>

				<ResponsiveDialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={!normalizedTitle || mutation.isPending}
					>
						<FilePlus2Icon data-icon="inline-start" />
						{mutation.isPending ? "Creating…" : "Create page"}
					</Button>
				</ResponsiveDialogFooter>
			</form>
		</ResponsiveDialog>
	);
}

function CreateTaskDialog({
	open,
	onOpenChange,
	onPendingChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPendingChange: (pending: boolean) => void;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();
	const [pending, setPending] = useState(false);
	const mutation = useMutation({
		...createTaskMutationOptions(),
		meta: { errorMode: "inline" },
	});

	function changePending(nextPending: boolean) {
		setPending(nextPending);
		onPendingChange(nextPending);
	}

	async function createTask(input: {
		title: string;
		dueDate: string | null;
		dueTime: string | null;
		reminderOffsetMinutes: TaskReminderOffsetMinutes;
		assigneeId?: string | null;
	}): Promise<TaskSubmissionResult> {
		try {
			await mutation.mutateAsync({
				body: {
					workspaceId,
					title: input.title,
					...(input.dueDate ? { dueDate: input.dueDate } : {}),
					...(input.dueTime ? { dueTime: input.dueTime } : {}),
					...(input.reminderOffsetMinutes !== null
						? { reminderOffsetMinutes: input.reminderOffsetMinutes }
						: {}),
					...(input.assigneeId !== undefined
						? { assigneeId: input.assigneeId }
						: {}),
				},
			});
			void invalidateTasks(queryClient).catch(() => undefined);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error: contractErrorMessage(
					error,
					"Task could not be added. Try again.",
				),
			};
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) onOpenChange(next);
			}}
			title="Create task"
			description="Add a task to this workspace."
			className="sm:max-w-md"
		>
			{open ? (
				<TaskComposer
					currentUserId={currentUser?.id ?? null}
					mode="dialog"
					onSubmit={createTask}
					onPendingChange={changePending}
					onSuccess={() => onOpenChange(false)}
					onCancel={() => onOpenChange(false)}
				/>
			) : null}
		</ResponsiveDialog>
	);
}

function CreateCanvasDialog({
	open,
	onOpenChange,
	onPendingChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPendingChange: (pending: boolean) => void;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const mutation = useMutation({
		...createCanvasMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const normalizedTitle = title.trim();

	useEffect(() => {
		if (!open) return;
		setTitle("");
		setError(null);
	}, [open]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!normalizedTitle || mutation.isPending) return;
		setError(null);
		onPendingChange(true);

		try {
			const canvas = await mutation.mutateAsync({
				body: { workspaceId, title: normalizedTitle },
			});
			void invalidateCanvases(queryClient).catch(() => undefined);
			onOpenChange(false);
			router.push(`/w/${workspaceId}/c/${canvas.id}`);
		} catch (createError) {
			setError(
				contractErrorMessage(
					createError,
					"The canvas could not be created. Try again.",
				),
			);
		} finally {
			onPendingChange(false);
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(next) => {
				if (!mutation.isPending) onOpenChange(next);
			}}
			title="Create canvas"
			description="Add a new canvas to this workspace."
			className="sm:max-w-md"
		>
			<form className="flex flex-col gap-5" onSubmit={submit}>
				<div className="flex flex-col gap-2">
					<Label htmlFor="create-canvas-title">Title</Label>
					<Input
						id="create-canvas-title"
						name="title"
						autoFocus
						autoComplete="off"
						maxLength={CANVAS_TITLE_MAX_LENGTH}
						value={title}
						placeholder="Canvas title"
						aria-invalid={Boolean(error)}
						aria-describedby={error ? "create-canvas-error" : undefined}
						onChange={(event) => {
							setTitle(event.target.value);
							if (error) setError(null);
						}}
					/>
					{error ? (
						<p
							id="create-canvas-error"
							role="alert"
							className="text-destructive text-sm"
						>
							{error}
						</p>
					) : null}
				</div>

				<ResponsiveDialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={!normalizedTitle || mutation.isPending}
					>
						<ShapesIcon data-icon="inline-start" />
						{mutation.isPending ? "Creating…" : "Create canvas"}
					</Button>
				</ResponsiveDialogFooter>
			</form>
		</ResponsiveDialog>
	);
}

export function CreateDialogProvider({
	workspaceId,
	children,
}: {
	workspaceId: string;
	children: ReactNode;
}) {
	const canEdit = useCanEditWorkspace();
	const { isMobile, setOpenMobile } = useSidebar();
	const [dialog, setDialog] = useState<"canvas" | "page" | "task" | null>(null);
	const [pending, setPending] = useState(false);

	const openCreatePage = useCallback(() => {
		if (!canEdit || dialog !== null || pending) return;
		if (isMobile) setOpenMobile(false);
		setDialog("page");
	}, [canEdit, dialog, isMobile, pending, setOpenMobile]);
	const openCreateTask = useCallback(() => {
		if (!canEdit || dialog !== null || pending) return;
		if (isMobile) setOpenMobile(false);
		setDialog("task");
	}, [canEdit, dialog, isMobile, pending, setOpenMobile]);
	const openCreateCanvas = useCallback(() => {
		if (!canEdit || dialog !== null || pending) return;
		if (isMobile) setOpenMobile(false);
		setDialog("canvas");
	}, [canEdit, dialog, isMobile, pending, setOpenMobile]);

	useCommand(
		canEdit
			? {
					id: "page.create",
					title: "Create page",
					group: "Create",
					keywords: "new note add",
					icon: FilePlus2Icon,
					shortcut: "⌘⇧C",
					weight: -10,
					run: openCreatePage,
				}
			: null,
	);

	useCommand(
		canEdit
			? {
					id: "canvas.create",
					title: "Create canvas",
					group: "Create",
					keywords: "new draw drawing sketch",
					icon: ShapesIcon,
					run: openCreateCanvas,
				}
			: null,
	);

	useCommand(
		canEdit
			? {
					id: "task.create",
					title: "Create task",
					group: "Create",
					keywords: "new todo add",
					icon: ListTodoIcon,
					shortcut: "⌘⇧↵",
					run: openCreateTask,
				}
			: null,
	);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.repeat ||
				!event.shiftKey ||
				(!event.metaKey && !event.ctrlKey) ||
				!canEdit ||
				dialog !== null ||
				pending
			)
				return;

			if (event.key.toLowerCase() === "c") {
				event.preventDefault();
				openCreatePage();
			} else if (event.key === "Enter") {
				event.preventDefault();
				openCreateTask();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [canEdit, dialog, openCreatePage, openCreateTask, pending]);

	const contextValue = useMemo(
		() => ({ openCreateCanvas, openCreatePage, openCreateTask }),
		[openCreateCanvas, openCreatePage, openCreateTask],
	);

	return (
		<CreateDialogContext.Provider value={contextValue}>
			{children}
			<CreateCanvasDialog
				open={dialog === "canvas"}
				onOpenChange={(open) => setDialog(open ? "canvas" : null)}
				onPendingChange={setPending}
				workspaceId={workspaceId}
			/>
			<CreatePageDialog
				open={dialog === "page"}
				onOpenChange={(open) => setDialog(open ? "page" : null)}
				onPendingChange={setPending}
				workspaceId={workspaceId}
			/>
			<CreateTaskDialog
				open={dialog === "task"}
				onOpenChange={(open) => setDialog(open ? "task" : null)}
				onPendingChange={setPending}
				workspaceId={workspaceId}
			/>
		</CreateDialogContext.Provider>
	);
}
