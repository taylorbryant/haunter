import type { CompanionPageItem } from "./schemas";

export function icon(name: "page" | "chevron") {
	const template = document.getElementById(
		`icon-${name}`,
	) as HTMLTemplateElement;
	return template.content.cloneNode(true);
}

export function pageSymbol(item: CompanionPageItem) {
	const symbol = document.createElement("span");
	symbol.className = "page-symbol";
	symbol.setAttribute("aria-hidden", "true");
	if (item.icon) symbol.textContent = item.icon;
	else symbol.append(icon("page"));
	return symbol;
}

function pageButton(item: CompanionPageItem, open: (id: string) => void) {
	const button = document.createElement("button");
	button.type = "button";
	button.dataset.pageId = item.pageId;
	button.title = item.title || "Untitled page";
	const title = document.createElement("span");
	title.className = "page-link-title";
	title.textContent = item.title || "Untitled page";
	button.append(pageSymbol(item), title);
	button.addEventListener("click", () => open(item.pageId));
	return button;
}

/** Disclosure lists preserve normal button keyboard behavior, including Tab. */
export function renderPageNavigation(
	container: HTMLElement,
	items: CompanionPageItem[],
	expanded: Set<string>,
	open: (id: string) => void,
) {
	container.replaceChildren();
	const ids = new Set(items.map((item) => item.pageId));
	const children = new Map<string, CompanionPageItem[]>();
	for (const item of items) {
		if (!item.parentPageId || !ids.has(item.parentPageId)) continue;
		const siblings = children.get(item.parentPageId) ?? [];
		siblings.push(item);
		children.set(item.parentPageId, siblings);
	}
	const visited = new Set<string>();
	const branch = (item: CompanionPageItem): HTMLLIElement | undefined => {
		if (visited.has(item.pageId)) return;
		visited.add(item.pageId);
		const node = document.createElement("li");
		const row = document.createElement("div");
		row.className = "page-row";
		const button = pageButton(item, open);
		button.className = "page-link";
		row.append(button);
		node.append(row);
		const nested = (children.get(item.pageId) ?? []).flatMap((child) => {
			const childNode = branch(child);
			return childNode ? [childNode] : [];
		});
		if (nested.length) {
			row.classList.add("has-children");
			const group = document.createElement("ul");
			group.className = "page-children";
			group.id = `children-${item.pageId}`;
			group.hidden = !expanded.has(item.pageId);
			group.append(...nested);
			const toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "tree-toggle";
			toggle.append(icon("chevron"));
			toggle.setAttribute("aria-controls", group.id);
			const sync = () => {
				toggle.setAttribute("aria-expanded", String(!group.hidden));
				toggle.setAttribute(
					"aria-label",
					`${group.hidden ? "Expand" : "Collapse"} ${item.title || "Untitled page"}`,
				);
			};
			toggle.addEventListener("click", () => {
				group.hidden = !group.hidden;
				if (group.hidden) expanded.delete(item.pageId);
				else expanded.add(item.pageId);
				sync();
			});
			sync();
			row.prepend(toggle);
			node.append(group);
		}
		return node;
	};
	const list = document.createElement("ul");
	list.className = "page-branch";
	// Keep server order (Haunter's page positions), and show orphaned/cyclic
	// metadata as roots rather than losing otherwise readable pages.
	for (const item of items.filter(
		(item) => !item.parentPageId || !ids.has(item.parentPageId),
	)) {
		const node = branch(item);
		if (node) list.append(node);
	}
	for (const item of items) {
		const node = branch(item);
		if (node) list.append(node);
	}
	container.append(list);
}

export function renderRecentPages(
	container: HTMLElement,
	items: CompanionPageItem[],
	open: (id: string) => void,
	date: (value?: string) => string,
) {
	container.replaceChildren();
	for (const item of items) {
		const button = pageButton(item, open);
		button.className = "recent-page";
		if (item.updatedAt) {
			const subtitle = document.createElement("span");
			subtitle.className = "page-link-date";
			subtitle.textContent = date(item.updatedAt);
			button.append(subtitle);
		}
		container.append(button);
	}
}

export function pageAncestors(items: CompanionPageItem[], pageId: string) {
	const byId = new Map(items.map((item) => [item.pageId, item]));
	const result: CompanionPageItem[] = [];
	const seen = new Set([pageId]);
	let parentId = byId.get(pageId)?.parentPageId;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = byId.get(parentId);
		if (!parent) break;
		result.unshift(parent);
		parentId = parent.parentPageId;
	}
	return result;
}
