import type { CompanionPageItem } from "./schemas";
import { pageAncestors } from "./navigation";

/** Small native dialog: keyboard focus, Escape and focus restoration stay browser-owned. */
export function workspaceDialog(input: {
	title: string;
	submit: string;
	description?: string;
	name?: string;
	parents?: CompanionPageItem[];
	parentId?: string | null;
	excludeId?: string;
}): Promise<{ name: string; parentId: string | null } | null> {
	const dialog = document.createElement("dialog");
	dialog.className = "workspace-dialog";
	const heading = document.createElement("h2");
	heading.id = "workspace-dialog-title";
	heading.textContent = input.title;
	dialog.setAttribute("aria-labelledby", heading.id);
	const form = document.createElement("form");
	form.append(heading);
	if (input.description) {
		const p = document.createElement("p");
		p.className = "muted";
		p.textContent = input.description;
		form.append(p);
	}
	const name = document.createElement("input");
	name.name = "title";
	name.maxLength = 200;
	name.value = input.name ?? "";
	name.placeholder = "Untitled";
	if (input.name !== undefined) {
		const label = document.createElement("label");
		label.textContent = "Name";
		label.append(name);
		form.append(label);
	}
	const parent = document.createElement("select");
	parent.name = "parent";
	if (input.parents) {
		const label = document.createElement("label");
		label.textContent = "Location";
		parent.add(new Option("Workspace", ""));
		for (const page of input.parents) {
			if (
				page.pageId === input.excludeId ||
				pageAncestors(input.parents, page.pageId).some(
					(p) => p.pageId === input.excludeId,
				)
			)
				continue;
			parent.add(
				new Option(
					[...pageAncestors(input.parents, page.pageId), page]
						.map((p) => p.title || "Untitled")
						.join(" / "),
					page.pageId,
				),
			);
		}
		parent.value = input.parentId ?? "";
		label.append(parent);
		form.append(label);
	}
	const actions = document.createElement("div");
	actions.className = "dialog-actions";
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.className = "btn";
	cancel.textContent = "Cancel";
	const submit = document.createElement("button");
	submit.type = "submit";
	submit.className = "btn primary";
	submit.textContent = input.submit;
	actions.append(cancel, submit);
	form.append(actions);
	dialog.append(form);
	document.body.append(dialog);
	return new Promise((resolve) => {
		let result: { name: string; parentId: string | null } | null = null;
		dialog.addEventListener(
			"close",
			() => {
				dialog.remove();
				resolve(result);
			},
			{ once: true },
		);
		cancel.addEventListener("click", () => dialog.close());
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			result = { name: name.value.trim(), parentId: parent.value || null };
			dialog.close();
		});
		dialog.showModal();
		if (input.name !== undefined) {
			name.focus();
			name.select();
		} else if (input.parents) parent.focus();
		else cancel.focus();
	});
}
