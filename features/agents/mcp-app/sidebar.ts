const storageKey = "haunter-mcp-sidebar-expanded";

/** Changing navigation visibility never closes or replaces the editor frame. */
export function createSidebar() {
	const shell = document.querySelector<HTMLElement>(".companion")!;
	const sidebar = document.getElementById("workspace-sidebar")!;
	const toggle = document.getElementById("sidebar-toggle")!;
	const narrow = window.matchMedia("(max-width: 600px)");
	let desktopExpanded = true;
	let narrowExpanded = true;
	try {
		desktopExpanded = localStorage.getItem(storageKey) !== "false";
	} catch {
		// Storage is optional in a sandboxed host.
	}
	function render() {
		const expanded = narrow.matches ? narrowExpanded : desktopExpanded;
		if (!expanded && sidebar.contains(document.activeElement)) toggle.focus();
		sidebar.hidden = !expanded;
		shell.classList.toggle("sidebar-open", expanded);
		toggle.setAttribute("aria-expanded", String(expanded));
		const label = expanded ? "Collapse sidebar" : "Expand sidebar";
		toggle.setAttribute("aria-label", label);
		toggle.setAttribute("title", label);
	}
	const click = () => {
		if (narrow.matches) narrowExpanded = !narrowExpanded;
		else {
			desktopExpanded = !desktopExpanded;
			try {
				localStorage.setItem(storageKey, String(desktopExpanded));
			} catch {
				// The current panel still remembers the choice in memory.
			}
		}
		render();
	};
	toggle.addEventListener("click", click);
	narrow.addEventListener("change", render);
	render();
	return {
		showContent() {
			narrowExpanded = false;
			render();
		},
		showHome() {
			narrowExpanded = true;
			render();
		},
		dispose() {
			toggle.removeEventListener("click", click);
			narrow.removeEventListener("change", render);
		},
	};
}
