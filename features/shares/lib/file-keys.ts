import type { BlockJson } from "@/features/pages/schemas";

const FILE_URL_PREFIX = "/api/files/";
const SHARED_FILE_URL_PATTERN = /^\/api\/shared\/[^/]+\/files\//;

function fileKeyFromUrl(value: string): string | null {
	if (value.startsWith(FILE_URL_PREFIX)) {
		return value.slice(FILE_URL_PREFIX.length);
	}
	if (SHARED_FILE_URL_PATTERN.test(value)) {
		return value.replace(SHARED_FILE_URL_PATTERN, "");
	}
	return null;
}

export function contentReferencesFileKey(
	blocks: BlockJson[],
	key: string,
): boolean {
	function walk(nodes: BlockJson[]): boolean {
		for (const block of nodes) {
			for (const value of Object.values(block.props)) {
				if (typeof value === "string" && fileKeyFromUrl(value) === key) {
					return true;
				}
			}
			if (block.children.length > 0 && walk(block.children)) return true;
		}
		return false;
	}

	return walk(blocks);
}
