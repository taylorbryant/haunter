export function sharedFileHeaders(object: {
	contentType?: string | null;
	size: number;
}): HeadersInit {
	return {
		"content-type": object.contentType ?? "application/octet-stream",
		"content-length": String(object.size),
		// Shared files are valid only while the current page content references
		// the key, so do not let old responses outlive that authorization check.
		"cache-control": "no-store",
	};
}
