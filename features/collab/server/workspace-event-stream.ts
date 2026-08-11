import type { WorkspaceEventSubscriberPort } from "@/features/collab/workspace-events";

const encoder = new TextEncoder();

export const WORKSPACE_EVENT_STREAM_MAX_LIFETIME_MS = 240_000;
export const WORKSPACE_EVENT_STREAM_LEASE_TTL_MS = 300_000;

function encodeEvent(name: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createWorkspaceEventStream(input: {
	workspaceId: string;
	signal: AbortSignal;
	subscriptions: WorkspaceEventSubscriberPort;
	onError(error: unknown): void;
	onClose?(): Promise<void> | void;
	heartbeatMs?: number;
	maxLifetimeMs?: number;
}): Response | null {
	if (!input.subscriptions.isConfigured()) return null;

	let cleanup: ((closeController: boolean) => void) | null = null;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let heartbeat: ReturnType<typeof setInterval> | null = null;
			let lifetime: ReturnType<typeof setTimeout> | null = null;
			let onAbort = () => {};
			const subscription = input.subscriptions.subscribe({
				workspaceId: input.workspaceId,
				onReady() {
					if (!closed) controller.enqueue(encodeEvent("connected", {}));
				},
				onEvent(event) {
					if (!closed)
						controller.enqueue(encodeEvent("workspace-event", event));
				},
				onError(error) {
					input.onError(error);
					cleanup?.(true);
				},
			});

			cleanup = (closeController) => {
				if (closed) return;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				if (lifetime) clearTimeout(lifetime);
				input.signal.removeEventListener("abort", onAbort);
				void Promise.resolve()
					.then(() => subscription?.unsubscribe())
					.catch(input.onError);
				void Promise.resolve()
					.then(() => input.onClose?.())
					.catch(input.onError);
				if (closeController) controller.close();
			};
			onAbort = () => cleanup?.(false);

			if (!subscription) {
				cleanup(true);
				return;
			}

			heartbeat = setInterval(() => {
				if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
			}, input.heartbeatMs ?? 25_000);
			lifetime = setTimeout(
				() => cleanup?.(true),
				input.maxLifetimeMs ?? WORKSPACE_EVENT_STREAM_MAX_LIFETIME_MS,
			);
			input.signal.addEventListener("abort", onAbort, { once: true });
			if (input.signal.aborted) onAbort();
		},
		cancel() {
			cleanup?.(false);
		},
	});

	return new Response(stream, {
		headers: {
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"content-type": "text/event-stream; charset=utf-8",
			"x-accel-buffering": "no",
		},
	});
}
