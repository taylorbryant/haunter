import { APP_THEMES, getAppTheme, type AppThemeId } from "@/lib/themes";

const storageKey = "haunter-mcp-theme";

/** The panel has its own preference; it never writes the web app's theme keys. */
export function createAppearance(
	applyEditorTheme: (theme: AppThemeId) => void,
) {
	const select = document.getElementById(
		"appearance-theme",
	) as HTMLSelectElement;
	let preference: AppThemeId | "host" = "host";
	let hostTheme: "light" | "dark" = "light";
	try {
		const stored = localStorage.getItem(storageKey);
		preference = getAppTheme(stored ?? undefined)?.id ?? "host";
	} catch {
		// Sandboxed hosts can disable storage. The control still works in memory.
	}
	for (const scheme of ["light", "dark"] as const) {
		const group = document.createElement("optgroup");
		group.label = scheme === "light" ? "Light themes" : "Dark themes";
		for (const theme of APP_THEMES.filter(
			(item) => item.colorScheme === scheme,
		)) {
			const option = document.createElement("option");
			option.value = theme.id;
			option.textContent = theme.label;
			group.append(option);
		}
		select.append(group);
	}
	select.value = preference;
	function apply() {
		const id = preference === "host" ? hostTheme : preference;
		document.documentElement.dataset.theme = id;
		document.documentElement.style.colorScheme = getAppTheme(id)!.colorScheme;
		applyEditorTheme(id);
	}
	const change = () => {
		preference = getAppTheme(select.value)?.id ?? "host";
		try {
			localStorage.setItem(storageKey, preference);
		} catch {
			// Keep the active choice even if it cannot survive closing this panel.
		}
		apply();
	};
	select.addEventListener("change", change);
	apply();
	return {
		applyHostTheme(theme: "light" | "dark") {
			hostTheme = theme;
			apply();
		},
		dispose() {
			select.removeEventListener("change", change);
		},
	};
}
