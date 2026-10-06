/**
 * OpenAI maps a connector's UI-domain hostname to a dedicated HTTPS sandbox.
 * Share the mapping between resource metadata and Next's build-time headers.
 * This is an iframe identity, not a Haunter API or authentication origin.
 * @param {string} value
 */
export function parseMcpUiDomain(value) {
	const invalid = () =>
		new Error(
			"MCP_UI_DOMAIN must be an exact HTTPS DNS origin without a port or path, with a hostname of at most 63 characters.",
		);
	let url;
	try {
		url = new URL(value);
	} catch {
		throw invalid();
	}
	const labels = url.hostname.split(".");
	const label = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
	if (
		url.protocol !== "https:" ||
		url.origin !== value ||
		url.port ||
		labels.length < 2 ||
		!labels.every((part) => label.test(part)) ||
		!/[a-z]/.test(labels.at(-1) ?? "") ||
		url.hostname.length > 63
	)
		throw invalid();
	return {
		domain: value,
		sandboxOrigin: `https://${labels.join("-")}.web-sandbox.oaiusercontent.com`,
	};
}
