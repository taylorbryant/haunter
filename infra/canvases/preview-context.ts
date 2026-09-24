import type { Browser } from "playwright";

export type PreviewFiles = Map<
	string,
	{ body: string | Buffer; contentType: string }
>;

/** Serve only exact, in-memory renderer assets; documents never authorize network requests. */
export async function createCanvasPreviewContext(
	browser: Browser,
	files: PreviewFiles,
) {
	const context = await browser.newContext({
		serviceWorkers: "block",
		acceptDownloads: false,
	});
	await context.route("**/*", (route) => {
		const file = files.get(route.request().url());
		return file
			? route.fulfill({
					status: 200,
					...file,
					headers: {
						"Content-Security-Policy":
							"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'",
					},
				})
			: route.abort("blockedbyclient");
	});
	await context.routeWebSocket(/.*/, (socket) => socket.close());
	return context;
}
