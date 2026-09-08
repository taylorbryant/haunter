import type {
	CanvasSyncServer,
	CanvasConnection,
	PreparedCanvasConnection,
} from "@/infra/canvases/sync-server";
import type { Hocuspocus, WebSocketLike } from "@hocuspocus/server";

/** Hocuspocus v4's Server wrapper is Node-only; Bun hosts its protocol engine directly. */
export function listenDocumentServer(
	hocuspocus: Hocuspocus,
	options: {
		port: number;
		hostname: string;
		origin: string;
		canAcceptConnections?: () => boolean;
		isReady?: () => boolean;
		canvases?: CanvasSyncServer;
	},
) {
	return Bun.serve<{
		request: Request;
		canvasPrepared?: PreparedCanvasConnection;
		canvas?: CanvasConnection;
		connection?: ReturnType<Hocuspocus["handleConnection"]>;
	}>({
		port: options.port,
		hostname: options.hostname,
		async fetch(request, server) {
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
				if (new URL(request.url).pathname !== "/health")
					return new Response("Not found", { status: 404 });
				const ready =
					options.canAcceptConnections?.() !== false &&
					options.isReady?.() !== false;
				return Response.json({ ready }, { status: ready ? 200 : 503 });
			}
			if (options.canAcceptConnections?.() === false)
				return new Response("Collaboration is shutting down.", { status: 503 });
			const origin = request.headers.get("origin");
			if (origin && origin !== options.origin)
				return new Response("Forbidden", { status: 403 });
			let canvasPrepared: PreparedCanvasConnection | undefined;
			if (new URL(request.url).pathname.startsWith("/canvas/")) {
				if (!options.canvases)
					return new Response("Not found", { status: 404 });
				try {
					canvasPrepared = await options.canvases.prepare(request);
				} catch {
					return new Response("Canvas connection unavailable", { status: 403 });
				}
			}
			if (server.upgrade(request, { data: { request, canvasPrepared } }))
				return;
			return new Response("Upgrade failed", { status: 400 });
		},
		websocket: {
			maxPayloadLength: 8 * 1024 * 1024,
			open(socket) {
				if (socket.data.canvasPrepared && options.canvases) {
					socket.data.canvas = options.canvases.open(
						socket.data.canvasPrepared,
						socket,
					);
					return;
				}
				const transport: WebSocketLike = {
					get readyState() {
						return socket.readyState;
					},
					close: (code, reason) => socket.close(code, reason),
					send(data) {
						if (data instanceof Blob)
							throw new Error("Unexpected binary message type");
						socket.send(
							typeof data === "string"
								? data
								: ArrayBuffer.isView(data)
									? new Uint8Array(
											data.buffer,
											data.byteOffset,
											data.byteLength,
										)
									: new Uint8Array(data),
						);
					},
				};
				socket.data.connection = hocuspocus.handleConnection(
					transport,
					socket.data.request,
				);
			},
			message(socket, message) {
				if (socket.data.canvas) {
					options.canvases?.message(socket.data.canvas, message);
					return;
				}
				if (typeof message === "string") {
					socket.close(1003, "Binary messages required");
					return;
				}
				void socket.data.connection?.handleMessage(new Uint8Array(message));
			},
			close(socket, code, reason) {
				if (socket.data.canvas) {
					options.canvases?.close(socket.data.canvas, code, reason);
					return;
				}
				socket.data.connection?.handleClose({ code, reason });
			},
		},
	});
}

export async function stopDocumentServer(hocuspocus: Hocuspocus) {
	hocuspocus.closeConnections();
	hocuspocus.flushPendingStores();
	const deadline = Date.now() + 10_000;
	while (hocuspocus.getDocumentsCount() > 0) {
		if (Date.now() > deadline)
			throw new Error(
				"Documents could not be flushed; collaboration remains running to preserve unsaved state.",
			);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await hocuspocus.hooks("onDestroy", { instance: hocuspocus });
}
