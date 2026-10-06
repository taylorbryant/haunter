/**
 * Validate an exact parent origin for both the bridge and frame-ancestors config.
 * Node's URL implementation reports "null" for desktop custom-scheme origins,
 * even when the host browser registers that scheme as a standard origin.
 * @param {unknown} value
 */
export function isEmbeddedEditorOrigin(value) {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		if (url.protocol === "https:" || url.protocol === "http:")
			return url.origin === value && !url.hostname.includes("*");
		return (
			url.protocol === "codex-sandbox:" &&
			/^mcp-app-[a-f0-9]+\.web-sandbox\.oaiusercontent\.com$/.test(
				url.hostname,
			) &&
			!url.port &&
			value === `${url.protocol}//${url.host}`
		);
	} catch {
		return false;
	}
}
