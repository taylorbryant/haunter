export function pageExportFilename(title: string, extension: "md" | "html") {
	const safe = Array.from(title.trim(), (character) =>
		character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
			? "-"
			: character,
	)
		.join("")
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "")
		.slice(0, 180)
		.trim();
	return `${safe || "Untitled"}.${extension}`;
}
