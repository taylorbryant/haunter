/**
 * tldraw license key, passed to every <Tldraw> instance. Without one,
 * tldraw 5.x LOCKS the editor on non-localhost domains (the canvas renders
 * as an empty black box with no UI) — localhost is exempt, which is why
 * dev never shows the problem. Get a (free watermark or paid) key at
 * tldraw.dev and set NEXT_PUBLIC_TLDRAW_LICENSE_KEY in the deployment env.
 */
export const TLDRAW_LICENSE_KEY =
	process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY ?? undefined;
