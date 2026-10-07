import { createCanvasRenderingService } from "@/infra/canvases/rendering-service";

const url = process.argv[2];
if (url) {
	const endpoint = new URL("/health/renderer", url);
	const deadline = Date.now() + 90_000;
	let ready = false;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(endpoint, {
				signal: AbortSignal.timeout(5000),
			});
			const body = await response.json();
			if (response.ok && body.ready === true && body.verified === true) {
				ready = true;
				break;
			}
		} catch {
			/* Allow worker startup and one idle recovery probe. */
		}
		await Bun.sleep(1000);
	}
	if (!ready)
		throw new Error(
			"Worker renderer did not pass its synthetic startup checks.",
		);
	console.info("Worker renderer is ready and verified");
} else {
	const rendering = createCanvasRenderingService({
		licenseKey: process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY,
		onMetric: (metric) => console.info(JSON.stringify(metric)),
	});
	try {
		await rendering.warmup();
		if (!rendering.health().ready) throw new Error("Renderer is not ready");
		console.info("Sandboxed canvas rendering and layout verified");
	} finally {
		await rendering.stop();
	}
}
