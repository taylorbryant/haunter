"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { FilePlus2Icon, ShapesIcon, ListTodoIcon } from "lucide-react";
import { rq } from "@/client";
import { useDraftRegistry } from "@/client/use-draft-registry";
import {
	WorkspaceNavigationContext,
	WorkspaceLink,
} from "@/client/workspace-navigation";
import { useCurrentUser } from "@/components/app-session-provider";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import {
	CreateDialogProvider,
	useCreateDialog,
} from "@/components/create-dialog-provider";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { useEmbeddedHostTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceHeader } from "@/components/workspace-header";
import { HeaderPageActions } from "@/components/header-page-actions";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspacePicker } from "@/features/workspaces/components/workspace-picker";
import { CanvasList } from "@/features/canvases/components/canvas-list";
import {
	createCanvasMutationOptions,
	getCanvasQueryOptions,
	invalidateCanvases,
} from "@/features/canvases/client/queries";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	createPageMutationOptions,
	getPageMetadataQueryOptions,
	listPagesQueryOptions,
	invalidatePages,
	invalidatePageNavigation,
} from "@/features/pages/client/queries";
import { PageEditor } from "@/features/pages/components/page-editor";
import { HomeView } from "@/features/home/components/home-view";
import { TasksView } from "@/features/tasks/components/tasks-view";
import { TaskViewProvider } from "@/features/tasks/client/task-view-context";
import type { TaskView, SelectedTask } from "@/features/tasks/current-view";
import { TrashList } from "@/features/pages/components/trash-list";
import { EmbeddedEditorContext } from "@/features/pages/components/editor/embedded-editor-context";
import { APP_THEMES, getAppTheme, type AppThemeId } from "@/lib/themes";
import { listEmbeddedWorkspaces } from "../contracts";
import { pageResourceUri } from "../mcp-app/schemas";
import { observeEmbeddedTextSelection } from "../client/embedded-text-selection";
import { flushEmbeddedWorkspace } from "../client/embedded-workspace-save";
import {
	parseWorkspacePath,
	WorkspaceTargetSchema,
	workspaceTargetPath,
} from "../mcp-app/workspace-bridge";
import type { CurrentPageContext } from "../mcp-app/model-context";
import type { CanvasSelection } from "../mcp-app/editor-schema";
import { EmbeddedEditorBootstrap } from "./embedded-editor-bootstrap";
import { readBridge, send } from "./embedded-editor-frame";

const CanvasSurface = dynamic(
	() => import("@/features/canvases/components/canvas-surface"),
	{ ssr: false },
);

export function EmbeddedWorkspace({ initialPath }: { initialPath: string }) {
	const queryClient = useQueryClient();
	const [path, setPath] = useState(initialPath);
	const [error, setError] = useState("");
	const busy = useRef(false);
	const target = parseWorkspacePath(path);
	const navigate = useCallback(
		async (next: string) => {
			try {
				parseWorkspacePath(next);
				if (next === path || busy.current) return;
				busy.current = true;
				document.body.inert = true;
				const result = await flushEmbeddedWorkspace(
					queryClient,
					target.workspaceId,
					target.pageId,
					target.canvasId,
				);
				if (!result.saved || !result.locallySaved)
					throw new Error(
						"Your changes have not finished saving. Reconnect and try again.",
					);
				send(readBridge(), { type: "haunter/workspace/view", view: null });
				setError("");
				setPath(next);
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "This page could not be opened.",
				);
			} finally {
				busy.current = false;
				document.body.inert = false;
			}
		},
		[path, target.workspaceId, target.pageId, target.canvasId, queryClient],
	);
	const navigation = useMemo(
		() => ({
			pathname: path.split("?")[0],
			search: path.split("?")[1] ?? "",
			navigate,
		}),
		[path, navigate],
	);
	useEffect(() => {
		const bridge = readBridge();
		const listener = (event: MessageEvent) => {
			if (
				!bridge ||
				event.source !== window.parent ||
				event.origin !== bridge.origin ||
				event.data?.nonce !== bridge.nonce
			)
				return;
			if (event.data.type === "haunter/workspace/navigate") {
				const next = WorkspaceTargetSchema.safeParse(event.data.target);
				if (next.success) void navigate(workspaceTargetPath(next.data));
			}
			if (event.data.type === "haunter/editor/resume")
				document.body.inert = false;
			if (
				event.data.type === "haunter/editor/flush" &&
				typeof event.data.requestId === "string"
			) {
				if (event.data.pause) document.body.inert = true;
				void flushEmbeddedWorkspace(
					queryClient,
					target.workspaceId,
					target.pageId,
					target.canvasId,
				).then((result) =>
					send(bridge, {
						type: "haunter/editor/flushed",
						requestId: event.data.requestId,
						...result,
					}),
				);
			}
		};
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [
		navigate,
		target.workspaceId,
		target.pageId,
		target.canvasId,
		queryClient,
	]);
	return (
		<WorkspaceNavigationContext.Provider value={navigation}>
			<EmbeddedEditorBootstrap
				key={target.workspaceId}
				workspaceId={target.workspaceId}
				workspace
			>
				<WorkspaceShell
					path={path}
					navigate={navigate}
					error={error}
					onRemoved={(ids) => {
						if (!target.pageId || !ids.includes(target.pageId)) return false;
						// The confirmed removal already flushed this view. Its server sessions
						// are now invalid, so another remote flush cannot succeed.
						send(readBridge(), { type: "haunter/workspace/view", view: null });
						setError("");
						setPath(`/w/${encodeURIComponent(target.workspaceId)}/home`);
						return true;
					}}
				/>
			</EmbeddedEditorBootstrap>
		</WorkspaceNavigationContext.Provider>
	);
}

function WorkspaceShell({
	path,
	navigate,
	error,
	onRemoved,
}: {
	path: string;
	navigate(path: string): Promise<void>;
	error: string;
	onRemoved(ids: readonly string[]): boolean;
}) {
	const queryClient = useQueryClient();
	const target = parseWorkspacePath(path);
	const canEdit = useCanEditWorkspace();
	const [open, setOpen] = useState(true);
	const [appearance, setAppearance] = useState<AppThemeId | "host">("host");
	const [hostTheme, setHostTheme] = useState<"light" | "dark">("light");
	const setTheme = useEmbeddedHostTheme();
	const workspaces = useQuery(rq(listEmbeddedWorkspaces).queryOptions({}));
	useEffect(() => {
		try {
			setOpen(localStorage.getItem("haunter-mcp-sidebar-expanded") !== "false");
			const stored = localStorage.getItem("haunter-mcp-theme");
			if (getAppTheme(stored ?? undefined)?.id)
				setAppearance(getAppTheme(stored ?? undefined)!.id);
		} catch {
			/* Storage is optional in embedded hosts. */
		}
	}, []);
	useEffect(() => {
		setTheme?.(appearance === "host" ? hostTheme : appearance);
	}, [appearance, hostTheme, setTheme]);
	useEffect(() => {
		const bridge = readBridge();
		const listener = (event: MessageEvent) => {
			if (
				bridge &&
				event.source === window.parent &&
				event.origin === bridge.origin &&
				event.data?.nonce === bridge.nonce &&
				event.data.type === "haunter/workspace/theme" &&
				["light", "dark"].includes(event.data.theme)
			)
				setHostTheme(event.data.theme);
		};
		window.addEventListener("message", listener);
		send(bridge, { type: "haunter/workspace/ready" });
		return () => window.removeEventListener("message", listener);
	}, []);
	function changeAppearance(next: string) {
		const value = next === "host" ? "host" : getAppTheme(next)?.id;
		if (!value) return;
		setAppearance(value);
		try {
			localStorage.setItem("haunter-mcp-theme", value);
		} catch {
			/* optional */
		}
	}
	const name =
		workspaces.data?.workspaces.find(
			(workspace) => workspace.id === target.workspaceId,
		)?.name ?? "Workspace";
	async function beforeRemove() {
		const result = await flushEmbeddedWorkspace(
			queryClient,
			target.workspaceId,
			target.pageId,
			target.canvasId,
		);
		return result.saved && result.locallySaved;
	}
	return (
		<CommandRegistryProvider>
			<SidebarProvider
				persistCookie={false}
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					try {
						localStorage.setItem("haunter-mcp-sidebar-expanded", String(next));
					} catch {
						/* optional */
					}
				}}
				className="h-svh min-h-0 overflow-hidden bg-background text-foreground"
			>
				<CreateDialogProvider workspaceId={target.workspaceId}>
					<WorkspaceSidebar
						workspaceId={target.workspaceId}
						workspaceSwitcher={
							<WorkspacePicker
								workspaces={
									workspaces.data?.workspaces ?? [
										{ id: target.workspaceId, name },
									]
								}
								activeWorkspaceId={target.workspaceId}
								onSelect={(id) => navigate(`/w/${encodeURIComponent(id)}/home`)}
								initialLoading={workspaces.isPending}
								unavailable={workspaces.isError && !workspaces.data}
								onRetry={() => void workspaces.refetch()}
							/>
						}
						pageTreeProps={{
							allowImports: false,
							allowRecovery: true,
							allowFavorites: canEdit,
							onRemoved,
							beforeRemove,
						}}
						footer={
							<label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
								Appearance
								<select
									aria-label="Haunter theme"
									value={appearance}
									onChange={(event) => changeAppearance(event.target.value)}
									className="min-w-0 flex-1 rounded bg-sidebar py-2 text-foreground"
								>
									<option value="host">Follow host</option>
									{APP_THEMES.map((theme) => (
										<option key={theme.id} value={theme.id}>
											{theme.label}
										</option>
									))}
								</select>
							</label>
						}
					/>
					<SidebarInset className="min-h-0" data-haunter-embedded-workspace>
						<WorkspaceHeader>
							{target.canvasId ? (
								<CanvasParentLink
									canvasId={target.canvasId}
									workspaceId={target.workspaceId}
								/>
							) : null}
							<WorkspaceCreateButtons />
							<HeaderPageActions
								allowFavorites={canEdit}
								beforeRemove={beforeRemove}
								onRemoved={onRemoved}
							/>
						</WorkspaceHeader>
						{error && (
							<p role="alert" className="border-b p-3 text-sm text-destructive">
								{error}
							</p>
						)}
						<WorkspaceDocument
							key={path.split("?")[0]}
							path={path}
							workspaceName={name}
							navigate={navigate}
						/>
					</SidebarInset>
				</CreateDialogProvider>
			</SidebarProvider>
		</CommandRegistryProvider>
	);
}

function WorkspaceCreateButtons() {
	const canEdit = useCanEditWorkspace();
	const { openCreatePage, openCreateCanvas, openCreateTask } =
		useCreateDialog();
	if (!canEdit) return null;
	return (
		<div className="ml-auto flex gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Create task"
				onClick={openCreateTask}
			>
				<ListTodoIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Create page"
				onClick={openCreatePage}
			>
				<FilePlus2Icon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Create canvas"
				onClick={openCreateCanvas}
			>
				<ShapesIcon />
			</Button>
		</div>
	);
}

function CanvasParentLink({
	canvasId,
	workspaceId,
}: {
	canvasId: string;
	workspaceId: string;
}) {
	const enabled = useProtectedRequestsEnabled();
	const canvas = useQuery({ ...getCanvasQueryOptions(canvasId), enabled });
	if (!canvas.data?.pageId) return null;
	return (
		<Button
			variant="ghost"
			size="sm"
			render={
				<WorkspaceLink href={`/w/${workspaceId}/p/${canvas.data.pageId}`} />
			}
		>
			Back to page
		</Button>
	);
}

function WorkspaceDocument({
	path,
	workspaceName,
	navigate,
}: {
	path: string;
	workspaceName: string;
	navigate(path: string): Promise<void>;
}) {
	const target = parseWorkspacePath(path);
	const { workspaceId, pageId, canvasId } = target;
	const enabled = useProtectedRequestsEnabled();
	const canEdit = useCanEditWorkspace();
	const user = useCurrentUser();
	const queryClient = useQueryClient();
	const pages = useQuery({ ...listPagesQueryOptions(workspaceId), enabled });
	const page = useQuery({
		...getPageMetadataQueryOptions(pageId ?? ""),
		enabled: enabled && !!pageId,
	});
	const canvas = useQuery({
		...getCanvasQueryOptions(canvasId ?? ""),
		enabled: enabled && !!canvasId,
	});
	const createPage = useMutation(createPageMutationOptions());
	const createCanvas = useMutation(createCanvasMutationOptions());
	const registry = useDraftRegistry();
	const [selection, setSelection] = useState<CurrentPageContext["selection"]>();
	const [inlineCanvas, setInlineCanvas] =
		useState<CurrentPageContext["inlineCanvas"]>();
	const [canvasSelection, setCanvasSelection] = useState<CanvasSelection>();
	const [selectedTask, setSelectedTask] = useState<SelectedTask>();
	const [taskView, setTaskView] = useState<{ path: string; view?: TaskView }>();
	const taskViewChanged = useCallback(
		(view: TaskView | undefined) => setTaskView({ path, view }),
		[path],
	);
	const taskSelectionChanged = useCallback(
		(blockId: string, task: SelectedTask | undefined, activate = false) => {
			setSelectedTask((current) => {
				if (!activate && current?.sourceBlockId !== blockId) return current;
				return JSON.stringify(current) === JSON.stringify(task)
					? current
					: task;
			});
		},
		[],
	);
	useEffect(() => {
		if (!enabled) setSelectedTask(undefined);
	}, [enabled]);
	const currentTasks =
		enabled && taskView?.path === path ? taskView.view : undefined;
	const canvasSelectionChanged = useCallback(
		(_id: string, next: CanvasSelection) => setCanvasSelection(next),
		[],
	);
	const drafts = registry
		.entries(user?.id)
		.filter(
			(entry) =>
				entry.identity.workspaceId === workspaceId &&
				(entry.identity.resourceId === pageId ||
					entry.identity.resourceType === "canvas"),
		);
	const snapshots = drafts.map((entry) => entry.getSnapshot());
	const saveStatus = !drafts.length
		? "unknown"
		: snapshots.some((draft) => draft.dirty || !draft.locallySaved)
			? "unsaved"
			: snapshots.some((draft) => draft.error || draft.validationError)
				? "unknown"
				: "saved";
	useEffect(() => {
		if (!pageId || !enabled) return;
		return observeEmbeddedTextSelection(pageId, (next) => {
			setSelection(next.text ? next : undefined);
		});
	}, [pageId, enabled]);
	useEffect(() => {
		const clear = (event: PointerEvent) => {
			if (
				event.target instanceof Element &&
				event.target.closest(".bn-editor") &&
				!event.target.closest(".haunter-task")
			)
				setSelectedTask(undefined);
			if (
				event.target instanceof Element &&
				!event.target.closest(".haunter-canvas")
			)
				setInlineCanvas(undefined);
		};
		document.addEventListener("pointerdown", clear, true);
		return () => document.removeEventListener("pointerdown", clear, true);
	}, []);
	const title = canvasId
		? canvas.data?.title || "Canvas"
		: page.data?.title || "Untitled";
	const status =
		!enabled || page.isError || canvas.isError
			? "unavailable"
			: (canvasId ? canvas.data : page.data)
				? "ready"
				: "opening";
	useEffect(() => {
		send(readBridge(), {
			type: "haunter/workspace/view",
			view:
				pageId ||
				canvasId ||
				target.section === "home" ||
				target.section === "tasks"
					? {
							workspaceId,
							workspaceName,
							pageId: pageId ?? canvas.data?.pageId ?? null,
							...(canvasId
								? { canvasId, ...(enabled ? { canvas: canvasSelection } : {}) }
								: {}),
							title:
								target.section === "home"
									? "Home"
									: target.section === "tasks"
										? "Tasks"
										: title,
							...(target.section === "home" || target.section === "tasks"
								? { section: target.section, tasks: currentTasks }
								: {}),
							...(pageId && enabled && !page.isError && selectedTask
								? { selectedTask }
								: {}),
							url: new URL(path, window.location.origin).href,
							source:
								pageId && !canvasId
									? pageResourceUri(workspaceId, pageId)
									: new URL(path, window.location.origin).href,
							editorStatus:
								target.section === "home" || target.section === "tasks"
									? !enabled ||
										currentTasks?.lists.some(
											(list) => list.status === "unavailable",
										)
										? "unavailable"
										: currentTasks?.lists.length &&
												currentTasks.lists.every(
													(list) => list.status === "ready",
												)
											? "ready"
											: "opening"
									: status,
							saveStatus: currentTasks?.saveStatus ?? saveStatus,
							...(enabled && selection ? { selection } : {}),
							...(enabled && inlineCanvas ? { inlineCanvas } : {}),
						}
					: null,
		});
	}, [
		workspaceId,
		workspaceName,
		pageId,
		canvasId,
		canvas.data?.pageId,
		canvasSelection,
		title,
		path,
		status,
		saveStatus,
		enabled,
		selection,
		inlineCanvas,
		target.section,
		currentTasks,
		selectedTask,
		page.isError,
	]);
	const embedded = useMemo(
		() => ({
			workspaceId,
			pageId,
			taskControls: true,
			fileUploads: true,
			taskSelectionChanged,
			pages: (pages.data?.items ?? []).map((item) => ({
				pageId: item.id,
				title: item.title,
				icon: item.icon,
				parentPageId: item.parentPageId,
			})),
			openPage: (id: string, workspace = workspaceId) => {
				void navigate(`/w/${encodeURIComponent(workspace)}/p/${id}`);
			},
			openInHaunter: () =>
				send(readBridge(), { type: "haunter/workspace/open-web", path }),
			async createItem(action: "create-page" | "create-canvas") {
				if (action === "create-page") {
					const created = await createPage.mutateAsync({
						body: {
							workspaceId,
							title: "Untitled",
							...(pageId
								? { parentPageId: pageId, appendToParentContent: false }
								: {}),
						},
					});
					await Promise.all([
						invalidatePages(queryClient),
						invalidatePageNavigation(queryClient, workspaceId),
					]);
					return { id: created.id };
				}
				const created = await createCanvas.mutateAsync({
					body: {
						workspaceId,
						title: "Untitled",
						...(pageId ? { pageId } : {}),
					},
				});
				await invalidateCanvases(queryClient);
				return { id: created.id };
			},
			canvasSelectionChanged: (id: string, next: CanvasSelection) =>
				setInlineCanvas({ canvasId: id, selection: next }),
		}),
		[
			workspaceId,
			pages.data,
			navigate,
			path,
			createPage.mutateAsync,
			createCanvas.mutateAsync,
			pageId,
			queryClient,
			taskSelectionChanged,
		],
	);
	useEffect(() => {
		const click = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			const anchor =
				event.target instanceof Element
					? event.target.closest("a[href]")
					: null;
			if (!anchor) return;
			const url = new URL(
				anchor.getAttribute("href") ?? "",
				window.location.href,
			);
			if (
				url.origin !== window.location.origin ||
				!url.pathname.startsWith("/w/")
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			void navigate(url.pathname + url.search);
		};
		document.addEventListener("click", click);
		return () => document.removeEventListener("click", click);
	}, [navigate]);
	if (pageId)
		return (
			<div
				className="min-h-0 flex-1 overflow-auto"
				data-haunter-embedded-editor
			>
				<EmbeddedEditorContext.Provider value={embedded}>
					<PageEditor pageId={pageId} embedded />
				</EmbeddedEditorContext.Provider>
			</div>
		);
	if (canvasId)
		return (
			<div className="min-h-0 flex-1" data-haunter-embedded-editor>
				<CanvasSurface
					canvasId={canvasId}
					embedded
					layoutKey="workspace"
					onSelectionChange={canvasSelectionChanged}
				/>
			</div>
		);
	if (target.section === "home" || target.section === "tasks")
		return (
			<div className="min-h-0 flex-1 overflow-auto">
				<TaskViewProvider
					key={path}
					initialTaskId={target.taskId}
					onChange={taskViewChanged}
				>
					{target.section === "tasks" ? (
						<TasksView workspaceId={workspaceId} />
					) : (
						<HomeView workspaceId={workspaceId} />
					)}
				</TaskViewProvider>
			</div>
		);
	return (
		<div className="min-h-0 flex-1 overflow-auto p-6">
			<h1 className="mb-6 text-2xl font-semibold">
				{target.section === "trash"
					? "Trash"
					: target.section === "canvases"
						? "Canvases"
						: workspaceName}
			</h1>
			{target.section === "canvases" ? (
				<CanvasList
					workspaceId={workspaceId}
					allowDelete={false}
					allowFavorites={canEdit}
				/>
			) : target.section === "trash" ? (
				<TrashList workspaceId={workspaceId} allowPurge={false} />
			) : null}
		</div>
	);
}
