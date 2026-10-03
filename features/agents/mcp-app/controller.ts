import { createEditorFrame } from "./editor-controller";
import {
	EditorOutputSchema,
	type EditorOutput,
	selectionContextText,
	validateEditorOutput,
} from "./editor-schema";
import {
	icon,
	pageAncestors,
	renderPageNavigation,
	renderRecentPages,
} from "./navigation";
import {
	CompanionPageSchema,
	type CompanionPageItem,
	type CompanionWorkspace,
	ContextPageSchema,
	type ContextPage,
	MAX_CONTEXT_CHARACTERS,
	PageListSchema,
	pageContextText,
	WorkspaceListSchema,
} from "./schemas";

export type CompanionBridge = {
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
	openLink(url: string): Promise<void>;
	canUseContext(): boolean;
	setContext(text: string, page?: ContextPage): Promise<void>;
};

export function createCompanion(bridge: CompanionBridge) {
	const get = <T extends HTMLElement>(id: string) => {
		const element = document.getElementById(id);
		if (!element) throw new Error(`Missing companion element: ${id}`);
		return element as T;
	};
	const workspaceSelect = get<HTMLSelectElement>("workspace");
	const query = get<HTMLInputElement>("query");
	const useContext = get<HTMLButtonElement>("use-context");
	const removeContext = get<HTMLButtonElement>("remove-context");
	const refresh = get<HTMLButtonElement>("refresh");
	const search = get<HTMLButtonElement>("search");
	const home = get<HTMLButtonElement>("home");
	const web = get<HTMLButtonElement>("editor-web");
	const shell = get("detail").closest<HTMLElement>(".companion");
	let workspaces: CompanionWorkspace[] = [];
	let workspacePages: CompanionPageItem[] = [];
	let visiblePages: CompanionPageItem[] = [];
	const expanded = new Set<string>();
	let workspace: CompanionWorkspace | undefined;
	let page: EditorOutput | undefined;
	let attached: ContextPage | undefined;
	let listVersion = 0;
	let busy = false;
	let ready = false;
	let disposed = false;
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
	const editor = createEditorFrame(bridge, {
		frame: get<HTMLIFrameElement>("real-editor"),
		status: (text) => message("page-status", text),
		ready(value) {
			ready = value;
			updateControls();
		},
		metadata(value) {
			if (!page) return;
			page = { ...page, title: value.title };
			workspacePages = workspacePages.map((item) =>
				item.pageId === page?.pageId ? { ...item, ...value } : item,
			);
			visiblePages = visiblePages.map((item) =>
				item.pageId === page?.pageId ? { ...item, ...value } : item,
			);
			renderNavigation();
			updateBreadcrumbs();
		},
		async selection(text, selected) {
			if (
				!page ||
				selected.editorUrl !== page.editorUrl ||
				!bridge.canUseContext()
			)
				return;
			await action(async () => {
				// The selected text may be unsaved; current access must still be checked.
				const current = CompanionPageSchema.parse(
					await bridge.callTool("read_page", {
						workspaceId: selected.workspaceId,
						pageId: selected.pageId,
						format: "markdown",
					}),
				);
				const context = {
					workspaceId: selected.workspaceId,
					pageId: current.pageId,
					title: current.title,
					revision: current.revision,
					updatedAt: current.updatedAt,
				};
				await bridge.setContext(
					selectionContextText({ ...selected, title: current.title }, text),
					context,
				);
				attached = context;
				message(
					"page-status",
					"Selection added. Editing does not change this attachment.",
				);
			});
		},
	});
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
		useContext.hidden = !page;
		useContext.disabled = !page || !ready || busy || !bridge.canUseContext();
		removeContext.hidden = !attached;
		removeContext.disabled = busy;
		const isCurrent =
			page &&
			attached?.workspaceId === page.workspaceId &&
			attached.pageId === page.pageId;
		useContext.textContent = isCurrent ? "Update context" : "Use as context";
		message(
			"context-help",
			!bridge.canUseContext()
				? "Context attachments are unavailable in this host."
				: attached
					? "Editing and browsing do not change this attachment."
					: page
						? "Adds the latest saved page to this conversation."
						: "Choose a page to add it to this conversation.",
		);
		message(
			"context-status",
			attached
				? `Using “${attached.title || "Untitled page"}” in this conversation.`
				: "Your pages stay in Haunter.",
		);
		get("context-tray").dataset.attached = String(!!attached);
	}
	// All actions that can replace a frame or context run one at a time. Search
	// only changes the sidebar, so it never tears down an editor mid-keystroke.
	async function action(operation: () => Promise<void>) {
		if (busy || disposed) return;
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
		for (const button of get("page-list").querySelectorAll<HTMLButtonElement>(
			"button[data-page-id]",
		)) {
			if (button.dataset.pageId === page?.pageId)
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
			for (const ancestor of pageAncestors(workspacePages, page.pageId)) {
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
		get("empty-preview").hidden = false;
		shell?.classList.remove("has-page");
		message("page-status", "");
		updateSelection();
		updateBreadcrumbs();
	}
	async function showPage(next: EditorOutput) {
		await editor.initialize(next);
		page = next;
		get("empty-preview").hidden = true;
		shell?.classList.add("has-page");
		for (const ancestor of pageAncestors(workspacePages, next.pageId))
			expanded.add(ancestor.pageId);
		renderNavigation();
		updateBreadcrumbs();
	}
	async function openPage(pageId: string) {
		if (!workspace || page?.pageId === pageId) return;
		const workspaceId = workspace.id;
		await action(async () => {
			message("page-status", "Opening page…");
			const next = validateEditorOutput(
				await bridge.callTool("open_haunter_editor", { workspaceId, pageId }),
			);
			if (next.workspaceId !== workspaceId || next.pageId !== pageId)
				throw new Error("Haunter returned a different page. Try again.");
			await showPage(next);
		});
	}
	async function loadPages() {
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
				await bridge.callTool(
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
			if (!text) workspacePages = result.pages.slice(0, 100);
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
		if (workspace) await loadPages();
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
			workspaceSelect.value = next.id;
			workspacePages = [];
			visiblePages = [];
			expanded.clear();
			query.value = "";
			get("page-list").replaceChildren();
			get("recent-pages").replaceChildren();
			showHome();
			await loadPages();
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
			await loadPages();
			get("home-title").focus({ preventScroll: true });
		});
	get("back").addEventListener("click", () => void goHome());
	home.addEventListener("click", () => void goHome());
	web.addEventListener("click", () => {
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
	useContext.addEventListener("click", () => {
		if (!page || !workspace || !ready || !bridge.canUseContext()) return;
		const selected = page;
		const selectedWorkspace = workspace;
		void action(async () => {
			message("page-status", "Adding current saved page…");
			const result = await editor.save();
			if (!result.saved)
				throw new Error(
					"Wait for the editor to finish saving, then try again.",
				);
			const current = CompanionPageSchema.parse(
				await bridge.callTool("read_page", {
					workspaceId: selected.workspaceId,
					pageId: selected.pageId,
					format: "markdown",
				}),
			);
			const context = {
				workspaceId: selected.workspaceId,
				pageId: current.pageId,
				title: current.title,
				revision: current.revision,
				updatedAt: current.updatedAt,
			};
			await bridge.setContext(
				pageContextText(selectedWorkspace, current),
				context,
			);
			attached = context;
			page = { ...selected, title: current.title };
			updateBreadcrumbs();
			message(
				"page-status",
				current.markdown.length > MAX_CONTEXT_CHARACTERS
					? "Added a partial page with a source reference. Ask for the complete source if needed."
					: "Page added. Ask your next question about it.",
			);
		});
	});
	removeContext.addEventListener(
		"click",
		() =>
			void action(async () => {
				await bridge.setContext("");
				attached = undefined;
			}),
	);
	return {
		initialize,
		reload,
		applyTheme: editor.applyTheme,
		async prepareClose() {
			if (busy)
				throw new Error(
					"Wait for the current action to finish before closing Haunter.",
				);
			return editor.prepareClose();
		},
		dispose() {
			disposed = true;
			clearTimeout(searchTimer);
			editor.dispose();
		},
		syncContext(current: unknown) {
			if (current === undefined) return;
			const parsed = ContextPageSchema.safeParse(current);
			attached = parsed.success ? parsed.data : undefined;
			updateControls();
		},
		showConnectionError(text: string) {
			message("connection-status", text);
			updateControls();
		},
	};
}
