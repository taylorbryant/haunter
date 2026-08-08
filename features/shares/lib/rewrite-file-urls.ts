import type { BlockJson } from "@/features/content/schemas";

const FILE_URL_PREFIX = "/api/files/";

/**
 * Rewrite member-only file URLs (image/file blocks) into their share-scoped
 * equivalents so anonymous visitors can load them. Returns a new tree; the
 * original is not mutated.
 */
export function rewriteFileUrls(
	blocks: BlockJson[],
	token: string,
): BlockJson[] {
	return blocks.map((block) => {
		let props = block.props;
		for (const [key, value] of Object.entries(block.props)) {
			if (typeof value === "string" && value.startsWith(FILE_URL_PREFIX)) {
				props = {
					...props,
					[key]: `/api/shared/${token}/files/${value.slice(FILE_URL_PREFIX.length)}`,
				};
			}
		}
		return {
			...block,
			props,
			children: block.children.length
				? rewriteFileUrls(block.children, token)
				: block.children,
		};
	});
}
