import {
	EmbeddedWorkspaceSchema,
	WorkspaceActionResultSchema,
	type EmbeddedWorkspace,
	type WorkspaceAction,
} from "./workspace-schema";
import { createAppearance } from "./appearance";
import { createSidebar } from "./sidebar";
import { workspaceDialog } from "./workspace-dialog";
import { createEditorFrame } from "./editor-controller";
import { createCompanionContext, type ContextSnapshot } from "./model-context";
import {
	EditorOutputSchema,
	type EditorOutput,
	validateEditorOutput,
} from "./editor-schema";
import {
	icon,
	pageAncestors,
	renderPageNavigation,
	renderRecentPages,
} from "./navigation";
import {
	type CompanionPageItem,
	type CompanionWorkspace,
	PageListSchema,
	pageResourceUri,
	WorkspaceListSchema,
} from "./schemas";

export type CompanionBridge = {
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
	openLink(url: string): Promise<void>;
	canUseContext(): boolean;
	setContext(snapshot: ContextSnapshot): Promise<{ updateId: string } | void>;
};

export function createCompanion(bridge: CompanionBridge) {
	const get = <T extends HTMLElement>(id: string) => {
		const element = document.getElementById(id);
		if (!element) throw new Error(`Missing companion element: ${id}`);
		return element as T;
	};
	const workspaceSelect = get<HTMLSelectElement>("workspace");
	const query = get<HTMLInputElement>("query");
	const refresh = get<HTMLButtonElement>("refresh");
	const search = get<HTMLButtonElement>("search");
	const home = get<HTMLButtonElement>("home");
	const web = get<HTMLButtonElement>("editor-web");
	const shell = get("detail").closest<HTMLElement>(".companion");
	const sidebar = createSidebar();
	let workspaces: CompanionWorkspace[] = [];
	let workspacePages: CompanionPageItem[] = [];
	let visiblePages: CompanionPageItem[] = [];
	const expanded = new Set<string>();
	let workspace: CompanionWorkspace | undefined;
	let workspaceState: EmbeddedWorkspace | undefined;
	let archived: { workspaceId: string; pageId: string } | undefined;
	let page: EditorOutput | undefined;
	let listVersion = 0;
	let busy = false;
	let disposed = false;
	let closing = false;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const message = (id: string, text: string) => {
		get(id).textContent = text;
	};
	const errorMessage = (error: unknown) =>
		error instanceof Error
			? error.message
			: "Haunter could not complete this action.";
	const date = (value?: string) =>
		!value || Number.isNaN(Date.parse(value))
			? ""
			: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
					new Date(value),
				);
	const context = createCompanionContext({
		...bridge,
		changed: updateControls,
	});
	function updateCurrentView() {
		if (closing || disposed) return;
		const state = editor.context;
		context.setView(
			page && workspace && state.page?.editorUrl === page.editorUrl
				? {
						workspaceId: page.workspaceId,
						workspaceName: workspace.name,
						pageId: page.pageId,
						...(page.canvasId
							? { canvasId: page.canvasId, canvas: state.canvasSelection }
							: {}),
						...(state.selection ? { selection: state.selection } : {}),
						...(state.inlineCanvas ? { inlineCanvas: state.inlineCanvas } : {}),
						title: page.title,
						url: page.webUrl,
						source: page.canvasId
							? page.webUrl
							: pageResourceUri(page.workspaceId, page.pageId!),
						editorStatus: state.status,
						saveStatus: state.saveStatus,
					}
				: undefined,
		);
	}
	const editor = createEditorFrame(bridge, {
		frame: get<HTMLIFrameElement>("real-editor"),
		status: (text) => message("page-status", text),
		ready() {
			updateControls();
		},
		contextChanged() {
			updateCurrentView();
			updateControls();
		},
		openCanvas,
		openPage,
		async workspaceRequest(request) {
			if (!workspace || closing || disposed)
				throw new Error("Reopen Haunter to reconnect.");
			if (request.action === "list-pages") return { pages: workspacePages };
			if (busy || !page || page.canvasId)
				throw new Error("Wait for the current action to finish.");
			busy = true;
			updateControls();
			try {
				const result = await mutate(
					request.action === "create-page"
						? {
								action: "create-page",
								title: "",
								parentPageId: page.pageId!,
								atCursor: true,
							}
						: { action: "create-canvas", pageId: page.pageId! },
				);
				await loadWorkspace();
				return result;
			} finally {
				busy = false;
				updateControls();
			}
		},
		metadata(value, selected) {
			if (!page || page.editorUrl !== selected.editorUrl) return;
			page = { ...page, title: value.title };
			workspacePages = workspacePages.map((item) =>
				!page?.canvasId && item.pageId === page?.pageId
					? { ...item, ...value }
					: item,
			);
			visiblePages = visiblePages.map((item) =>
				!page?.canvasId && item.pageId === page?.pageId
					? { ...item, ...value }
					: item,
			);
			if (!page.canvasId)
				for (const button of get(
					"favorites-list",
				).querySelectorAll<HTMLButtonElement>("button[data-page-id]")) {
					if (button.dataset.pageId === page.pageId) {
						const label = button.querySelector(".page-link-title");
						if (label)
							label.textContent = `${value.icon ? `${value.icon} ` : ""}${value.title || "Untitled page"}`;
						button.title = value.title || "Untitled page";
					}
				}
			renderNavigation();
			updateBreadcrumbs();
			updateCurrentView();
		},
	});
	const appearance = createAppearance(editor.applyTheme);
	function updateControls() {
		shell?.setAttribute("aria-busy", String(busy));
		const sidebar = shell?.querySelector<HTMLElement>(".sidebar");
		if (sidebar) sidebar.inert = busy;
		get("breadcrumbs").inert = busy;
		get("recent-pages").inert = busy;
		workspaceSelect.disabled = busy || !workspace;
		query.disabled = busy || !workspace;
		search.disabled = busy || !workspace;
		refresh.disabled = busy;
		home.disabled = busy;
		get<HTMLButtonElement>("back").disabled = busy;
		web.hidden = !page;
		web.disabled = busy;
		get("page-actions").hidden = !page;
		for (const id of [
			"new-page",
			"new-canvas",
			"new-subpage",
			"move-page",
			"archive-page",
			"favorite-item",
		]) {
			get<HTMLButtonElement>(id).disabled = busy || !workspaceState?.canEdit;
		}
		for (const id of ["new-subpage", "move-page", "archive-page"])
			get(id).hidden = !!page?.canvasId;
		get("favorite-item").hidden = !!page?.canvasId && !!page.pageId;
		const favorite = page?.canvasId
			? workspaceState?.canvasFavorites.includes(page.canvasId)
			: !!page?.pageId && workspaceState?.favorites.includes(page.pageId);
		get("favorite-item").textContent = favorite
			? "Remove from favorites"
			: "Add to favorites";
		const state = editor.context;
		message(
			"editor-save-status",
			!page || state.status !== "ready"
				? ""
				: state.saveStatus === "unsaved"
					? "Saving…"
					: state.saveStatus === "saved"
						? "Saved"
						: "",
		);
		message(
			"context-status",
			context.error
				? "Page context could not sync. Reopen the panel to reconnect."
				: "",
		);
	}
	// All actions that can replace a frame or context run one at a time. Search
	// only changes the sidebar, so it never tears down an editor mid-keystroke.
	async function action(operation: () => Promise<void>) {
		if (busy || closing || disposed) return;
		busy = true;
		clearTimeout(searchTimer);
		updateControls();
		try {
			await operation();
		} catch (error) {
			editor.resume();
			message("page-status", errorMessage(error));
		} finally {
			busy = false;
			updateControls();
		}
	}
	function updateSelection() {
		if (page || query.value.trim()) home.removeAttribute("aria-current");
		else home.setAttribute("aria-current", "page");
		for (const button of shell!.querySelectorAll<HTMLButtonElement>(
			"button[data-page-id]",
		)) {
			if (!page?.canvasId && button.dataset.pageId === page?.pageId)
				button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		}
	}
	function updateBreadcrumbs() {
		const container = get("breadcrumbs");
		container.replaceChildren();
		if (page && workspace) {
			const root = document.createElement("button");
			root.type = "button";
			root.textContent = workspace.name;
			root.addEventListener("click", () => home.click());
			container.append(root);
			const ancestors = pageAncestors(workspacePages, page.pageId ?? "");
			const parent = page.canvasId
				? workspacePages.find((item) => item.pageId === page?.pageId)
				: undefined;
			if (parent) ancestors.push(parent);
			for (const ancestor of ancestors) {
				const separator = document.createElement("span");
				separator.className = "breadcrumb-separator";
				separator.setAttribute("aria-hidden", "true");
				separator.append(icon("chevron"));
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = ancestor.title || "Untitled page";
				button.addEventListener("click", () => void openPage(ancestor.pageId));
				container.append(separator, button);
			}
			const separator = document.createElement("span");
			separator.className = "breadcrumb-separator";
			separator.setAttribute("aria-hidden", "true");
			separator.append(icon("chevron"));
			container.append(separator);
		}
		const current = document.createElement("span");
		current.className = "breadcrumb-current";
		current.setAttribute("aria-current", "page");
		current.textContent = page
			? page.title || "Untitled page"
			: query.value.trim()
				? "Search"
				: "Home";
		container.append(current);
	}
	function renderNavigation() {
		renderPageNavigation(
			get("page-list"),
			visiblePages,
			expanded,
			(id) => void openPage(id),
		);
		updateSelection();
	}
	function showHome() {
		page = undefined;
		updateCurrentView();
		get("empty-preview").hidden = false;
		shell?.classList.remove("has-page");
		sidebar.showHome();
		message("page-status", "");
		updateSelection();
		updateBreadcrumbs();
	}
	async function showPage(next: EditorOutput) {
		await editor.initialize(next);
		page = next;
		get("empty-preview").hidden = true;
		shell?.classList.add("has-page");
		sidebar.showContent();
		for (const ancestor of pageAncestors(workspacePages, next.pageId ?? ""))
			expanded.add(ancestor.pageId);
		renderNavigation();
		updateBreadcrumbs();
		updateCurrentView();
	}
	async function openPage(pageId: string, targetWorkspaceId?: string) {
		if (
			!workspace ||
			(!page?.canvasId &&
				page?.pageId === pageId &&
				(!targetWorkspaceId || targetWorkspaceId === workspace.id))
		) {
			if (page) sidebar.showContent();
			return;
		}
		const workspaceId = targetWorkspaceId ?? workspace.id;
		await action(async () => {
			message("page-status", "");
			const next = validateEditorOutput(
				await bridge.callTool("open_haunter_editor", { workspaceId, pageId }),
			);
			if (next.workspaceId !== workspaceId || next.pageId !== pageId)
				throw new Error("Haunter returned a different page. Try again.");
			if (workspace?.id !== workspaceId)
				await initializeWorkspaces(
					await bridge.callTool("list_workspaces", {}),
					workspaceId,
				);
			await showPage(next);
		});
	}
	async function openCanvas(canvasId: string) {
		if (!workspace) return;
		const workspaceId = workspace.id;
		await action(async () => {
			const next = validateEditorOutput(
				await bridge.callTool("open_haunter_canvas", { workspaceId, canvasId }),
			);
			if (next.workspaceId !== workspaceId || next.canvasId !== canvasId)
				throw new Error("Haunter returned a different canvas. Try again.");
			await showPage(next);
		});
	}
	async function loadPages(knownPages?: CompanionPageItem[]) {
		if (!workspace) return;
		const selectedWorkspace = workspace;
		const version = ++listVersion;
		const text = query.value.trim();
		message("list-heading", text ? "Search results" : "Pages");
		message("home-title", text ? "Search" : "Home");
		message("recent-heading", text ? "Search results" : "Recently updated");
		message("home-status", "Loading pages…");
		message("list-status", "Loading pages…");
		get("list-status").classList.remove("sr-only");
		updateBreadcrumbs();
		try {
			const result = PageListSchema.parse(
				knownPages && text.length < 2
					? { pages: knownPages }
					: await bridge.callTool(
							text.length >= 2 ? "search_pages" : "list_pages",
							{
								workspaceId: selectedWorkspace.id,
								...(text.length >= 2 ? { query: text } : {}),
							},
						),
			);
			if (
				disposed ||
				version !== listVersion ||
				workspace !== selectedWorkspace
			)
				return;
			if (!text) workspacePages = result.pages;
			const pages = result.pages
				.filter(
					(item) =>
						text.length !== 1 ||
						item.title.toLocaleLowerCase().includes(text.toLocaleLowerCase()),
				)
				.slice(0, 100);
			visiblePages = text
				? pages.map((item) => ({
						...item,
						icon: workspacePages.find((known) => known.pageId === item.pageId)
							?.icon,
						parentPageId: null,
					}))
				: pages;
			renderNavigation();
			const recent = [...visiblePages].sort((a, b) =>
				(b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
			);
			renderRecentPages(
				get("recent-pages"),
				text ? recent : recent.slice(0, 8),
				(id) => void openPage(id),
				date,
			);
			message("page-count", String(pages.length));
			get("list-status").classList.toggle(
				"sr-only",
				pages.length > 0 && pages.length < 100,
			);
			message(
				"home-status",
				pages.length
					? ""
					: text
						? "No pages found. Try another search."
						: "No pages in this workspace yet.",
			);
			message(
				"list-status",
				pages.length
					? `${pages.length} ${pages.length === 1 ? "page" : "pages"}${pages.length === 100 ? " · Search to find more" : ""}`
					: text
						? "No pages found. Try another search."
						: "No pages in this workspace yet.",
			);
		} catch (error) {
			if (version === listVersion) {
				message("list-status", errorMessage(error));
				message("home-status", errorMessage(error));
			}
		}
	}
	async function mutate(operation: WorkspaceAction) {
		if (!workspace) throw new Error("Choose a workspace first.");
		return WorkspaceActionResultSchema.parse(
			await bridge.callTool("act_in_haunter_workspace", {
				workspaceId: workspace.id,
				operation,
			}),
		);
	}
	function itemButton(title: string, open: () => void) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "page-link";
		button.title = title;
		const label = document.createElement("span");
		label.className = "page-link-title";
		label.textContent = title;
		button.append(label);
		button.addEventListener("click", open);
		return button;
	}
	async function loadWorkspace() {
		if (!workspace) return;
		const selected = workspace;
		const result = EmbeddedWorkspaceSchema.parse(
			await bridge.callTool("get_haunter_workspace", {
				workspaceId: selected.id,
			}),
		);
		if (workspace !== selected || disposed) return;
		workspaceState = result;
		workspacePages = result.pages;
		const favorites = get("favorites-list");
		favorites.replaceChildren();
		for (const item of result.pages.filter((p) =>
			result.favorites.includes(p.pageId),
		)) {
			const button = itemButton(
				`${item.icon ? `${item.icon} ` : ""}${item.title || "Untitled page"}`,
				() => void openPage(item.pageId),
			);
			button.dataset.pageId = item.pageId;
			favorites.append(button);
		}
		for (const item of result.canvases.filter((c) =>
			result.canvasFavorites.includes(c.id),
		))
			favorites.append(
				itemButton(
					item.title || "Untitled canvas",
					() => void openCanvas(item.id),
				),
			);
		get("favorites-section").hidden = !favorites.childElementCount;
		const canvases = get("canvas-list");
		canvases.replaceChildren();
		for (const item of result.canvases)
			canvases.append(
				itemButton(
					item.title || "Untitled canvas",
					() => void openCanvas(item.id),
				),
			);
		get("canvases-section").hidden = !canvases.childElementCount;
		await loadPages(result.pages);
		updateControls();
	}
	async function createItem(kind: "page" | "subpage" | "canvas") {
		if (busy || !workspaceState?.canEdit) return;
		get("page-actions").removeAttribute("open");
		const selectedWorkspace = workspace?.id;
		const result = await workspaceDialog({
			title:
				kind === "canvas"
					? "New canvas"
					: kind === "subpage"
						? "New subpage"
						: "New page",
			submit: "Create",
			name: "",
			...(kind !== "canvas"
				? {
						parents: workspacePages,
						parentId: kind === "subpage" ? page?.pageId : null,
					}
				: {}),
		});
		if (!result || workspace?.id !== selectedWorkspace) return;
		await action(async () => {
			await editor.prepareClose();
			const created = await mutate(
				kind === "canvas"
					? { action: "create-canvas", title: result.name || "Untitled canvas" }
					: {
							action: "create-page",
							title: result.name,
							parentPageId: result.parentId ?? undefined,
						},
			);
			await loadWorkspace();
			const next = validateEditorOutput(
				await bridge.callTool(
					kind === "canvas" ? "open_haunter_canvas" : "open_haunter_editor",
					{
						workspaceId: workspace!.id,
						...(kind === "canvas"
							? { canvasId: created.id }
							: { pageId: created.id }),
					},
				),
			);
			await showPage(next);
		});
	}
	async function movePage() {
		if (busy || !workspaceState?.canEdit || !page?.pageId || page.canvasId)
			return;
		get("page-actions").removeAttribute("open");
		const selected = page;
		const result = await workspaceDialog({
			title: "Move page",
			submit: "Move",
			parents: workspacePages,
			parentId: workspacePages.find((p) => p.pageId === selected.pageId)
				?.parentPageId,
			excludeId: selected.pageId!,
		});
		if (!result || page !== selected) return;
		await action(async () => {
			await editor.prepareClose();
			await mutate({
				action: "move-page",
				pageId: selected.pageId!,
				parentPageId: result.parentId,
			});
			await loadWorkspace();
			updateBreadcrumbs();
			editor.resume();
		});
	}
	async function archivePage() {
		if (busy || !workspaceState?.canEdit || !page?.pageId || page.canvasId)
			return;
		get("page-actions").removeAttribute("open");
		const selected = page;
		const result = await workspaceDialog({
			title: "Move page to trash?",
			submit: "Move to trash",
			description: `“${page.title || "Untitled page"}” and its subpages will move to trash. You can undo this.`,
		});
		if (!result || page !== selected) return;
		await action(async () => {
			await editor.prepareClose();
			await mutate({ action: "archive-page", pageId: selected.pageId! });
			// Already flushed before mutation. Closing must not try to save an archived resource.
			editor.discardSaved();
			showHome();
			query.value = "";
			archived = {
				workspaceId: selected.workspaceId,
				pageId: selected.pageId!,
			};
			get("archive-notice").hidden = false;
			await loadWorkspace();
		});
	}
	async function initializeWorkspaces(data: unknown, selectedId?: string) {
		const next = WorkspaceListSchema.parse(data).workspaces;
		const selected =
			next.find((item) => item.id === (selectedId ?? workspace?.id)) ?? next[0];
		if (selectedId && selected?.id !== selectedId)
			throw new Error(
				"This workspace is no longer available. Refresh access in Haunter.",
			);
		await editor.close();
		workspaces = next;
		workspace = selected;
		workspaceState = undefined;
		for (const id of ["favorites-list", "canvas-list"])
			get(id).replaceChildren();
		for (const id of ["favorites-section", "canvases-section"])
			get(id).hidden = true;
		get("archive-notice").hidden = true;
		workspacePages = [];
		visiblePages = [];
		expanded.clear();
		query.value = "";
		++listVersion;
		workspaceSelect.replaceChildren();
		for (const item of workspaces) {
			const option = document.createElement("option");
			option.value = item.id;
			option.textContent = item.name;
			workspaceSelect.append(option);
		}
		if (!workspace) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "No authorized workspaces";
			workspaceSelect.append(option);
		}
		workspaceSelect.value = workspace?.id ?? "";
		get("page-list").replaceChildren();
		get("recent-pages").replaceChildren();
		message("page-count", "");
		message("list-status", "");
		message(
			"connection-status",
			workspace
				? ""
				: "Allow a workspace in Haunter’s connected agent settings, then refresh.",
		);
		message(
			"home-status",
			workspace ? "Loading pages…" : "No authorized workspaces.",
		);
		message(
			"home-date",
			new Intl.DateTimeFormat(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
			}).format(new Date()),
		);
		showHome();
		if (workspace) await loadWorkspace();
	}
	async function initialize(data: unknown) {
		await action(async () => {
			if (EditorOutputSchema.safeParse(data).success) {
				const next = validateEditorOutput(data);
				if (workspace?.id !== next.workspaceId)
					await initializeWorkspaces(
						await bridge.callTool("list_workspaces", {}),
						next.workspaceId,
					);
				await showPage(next);
			} else await initializeWorkspaces(data);
		});
	}
	async function reload() {
		await action(async () => {
			await initializeWorkspaces(await bridge.callTool("list_workspaces", {}));
		});
	}
	workspaceSelect.addEventListener("change", () => {
		const id = workspaceSelect.value;
		workspaceSelect.value = workspace?.id ?? "";
		void action(async () => {
			const next = workspaces.find((item) => item.id === id);
			if (!next || next.id === workspace?.id) return;
			await editor.close();
			workspace = next;
			workspaceState = undefined;
			for (const id of ["favorites-list", "canvas-list"])
				get(id).replaceChildren();
			for (const id of ["favorites-section", "canvases-section"])
				get(id).hidden = true;
			get("archive-notice").hidden = true;
			workspaceSelect.value = next.id;
			workspacePages = [];
			visiblePages = [];
			expanded.clear();
			query.value = "";
			get("page-list").replaceChildren();
			get("recent-pages").replaceChildren();
			showHome();
			await loadWorkspace();
		});
	});
	get("search-form").addEventListener("submit", (event) => {
		event.preventDefault();
		clearTimeout(searchTimer);
		if (!busy) void loadPages();
	});
	query.addEventListener("input", () => {
		clearTimeout(searchTimer);
		++listVersion;
		if (!busy) searchTimer = setTimeout(() => void loadPages(), 300);
	});
	refresh.addEventListener("click", () => void reload());
	const goHome = () =>
		action(async () => {
			await editor.close();
			query.value = "";
			showHome();
			await loadWorkspace();
			get("home-title").focus({ preventScroll: true });
		});
	get("back").addEventListener("click", () => {
		if (page?.canvasId && page.pageId) void openPage(page.pageId);
		else void goHome();
	});
	home.addEventListener("click", () => void goHome());
	web.addEventListener("click", () => {
		get("page-actions").removeAttribute("open");
		if (page)
			void bridge
				.openLink(page.webUrl)
				.catch(() =>
					message(
						"page-status",
						"The host could not open Haunter in your browser.",
					),
				);
	});

	get("new-page").addEventListener("click", () => void createItem("page"));
	get("new-subpage").addEventListener(
		"click",
		() => void createItem("subpage"),
	);
	get("new-canvas").addEventListener("click", () => void createItem("canvas"));
	get("move-page").addEventListener("click", () => void movePage());
	get("archive-page").addEventListener("click", () => void archivePage());
	get("favorite-item").addEventListener(
		"click",
		() =>
			void action(async () => {
				get("page-actions").removeAttribute("open");
				if (!page) return;
				await mutate(
					page.canvasId
						? {
								action: "favorite-canvas",
								canvasId: page.canvasId,
								favorite: !workspaceState?.canvasFavorites.includes(
									page.canvasId,
								),
							}
						: {
								action: "favorite-page",
								pageId: page.pageId!,
								favorite: !workspaceState?.favorites.includes(page.pageId!),
							},
				);
				await loadWorkspace();
			}),
	);
	get("undo-archive").addEventListener(
		"click",
		() =>
			void action(async () => {
				if (!archived || workspace?.id !== archived.workspaceId) return;
				await mutate({ action: "restore-page", pageId: archived.pageId });
				archived = undefined;
				get("archive-notice").hidden = true;
				await loadWorkspace();
			}),
	);
	return {
		initialize,
		reload,
		applyTheme: appearance.applyHostTheme,
		async prepareClose() {
			if (busy)
				throw new Error(
					"Wait for the current action to finish before closing Haunter.",
				);
			closing = true;
			try {
				const result = await editor.prepareClose();
				// Stop reporting the page and its selection when the panel closes.
				await context.clearView();
				return result;
			} catch (error) {
				closing = false;
				editor.resume();
				updateCurrentView();
				throw error;
			}
		},
		dispose() {
			disposed = true;
			appearance.dispose();
			sidebar.dispose();
			context.dispose();
			clearTimeout(searchTimer);
			editor.dispose();
		},
		syncContext(current: unknown) {
			context.sync(current);
		},
		showConnectionError(text: string) {
			message("connection-status", text);
			updateControls();
		},
	};
}
