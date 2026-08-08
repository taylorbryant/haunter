import type { BlockJson } from "@/features/content/schemas";

export const CODE_BLOCK_LANGUAGES = [
	{ id: "text", label: "Plain Text", aliases: ["txt", "plain", "plaintext"] },
	{ id: "typescript", label: "TypeScript", aliases: ["ts"] },
	{ id: "javascript", label: "JavaScript", aliases: ["js"] },
	{ id: "tsx", label: "TSX", aliases: ["typescriptreact"] },
	{ id: "python", label: "Python", aliases: ["py"] },
	{ id: "sql", label: "SQL", aliases: [] },
	{
		id: "shellscript",
		label: "Shell",
		aliases: ["bash", "sh", "shell", "zsh"],
	},
	{ id: "json", label: "JSON", aliases: [] },
	{ id: "yaml", label: "YAML", aliases: ["yml"] },
	{ id: "markdown", label: "Markdown", aliases: ["md"] },
] as const;

export const PLAINTEXT_CODE_BLOCK_LANGUAGE = "text";

/** Resolve supported ids and aliases; unknown non-empty labels use plain text. */
export function normalizeCodeBlockLanguage(language: unknown): string {
	if (typeof language !== "string") return "";

	const candidate = language.trim().toLowerCase();
	if (candidate.length === 0) return "";

	for (const supported of CODE_BLOCK_LANGUAGES) {
		if (
			supported.id === candidate ||
			(supported.aliases as readonly string[]).includes(candidate)
		) {
			return supported.id;
		}
	}

	return PLAINTEXT_CODE_BLOCK_LANGUAGE;
}

/** Normalize persisted or imported documents without mutating the source. */
export function normalizeCodeBlockLanguages(blocks: BlockJson[]): BlockJson[] {
	let changed = false;

	const visit = (block: BlockJson): BlockJson => {
		const children = block.children.map(visit);
		const childrenChanged = children.some(
			(child, index) => child !== block.children[index],
		);
		const currentLanguage =
			typeof block.props.language === "string" ? block.props.language : "";
		const language = normalizeCodeBlockLanguage(currentLanguage);
		const languageChanged =
			block.type === "codeBlock" && language !== currentLanguage;

		if (!childrenChanged && !languageChanged) return block;
		changed = true;

		return {
			...block,
			props: languageChanged ? { ...block.props, language } : block.props,
			children,
		};
	};

	const normalized = blocks.map(visit);
	return changed ? normalized : blocks;
}
