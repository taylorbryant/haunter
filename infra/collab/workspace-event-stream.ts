import "@beignet/core/server-only";
import { createServerSentEventResponse } from "@beignet/core/server";
import type {
	WorkspaceEventSubscriberPort,
	WorkspaceEventSubscription,
} from "@/features/collab/workspace-events";

export const WORKSPACE_EVENT_STREAM_MAX_LIFETIME_MS = 240_000;
export const WORKSPACE_EVENT_STREAM_LEASE_TTL_MS = 300_000;

async function cleanupWorkspaceEventStream(
	subscription: WorkspaceEventSubscription | null,
	onClose: (() => Promise<void> | void) | undefined,
): Promise<void> {
	const results = await Promise.allSettled([
		...(subscription
			? [Promise.resolve().then(() => subscription.unsubscribe())]
			: []),
		...(onClose ? [Promise.resolve().then(onClose)] : []),
	]);
	const errors = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, "Workspace event stream cleanup failed.");
	}
}

export function createWorkspaceEventStream(input: {
	workspaceId: string;
	signal: AbortSignal;
	subscriptions: WorkspaceEventSubscriberPort;
	onError(error: unknown): Promise<void> | void;
	onClose?(): Promise<void> | void;
	heartbeatMs?: number;
	maxLifetimeMs?: number;
}): Response | null {
	if (!input.subscriptions.isConfigured()) return null;
	const requestAlreadyAborted = input.signal.aborted;

	const reportError = (error: unknown) => {
		void Promise.resolve()
			.then(() => input.onError(error))
			.catch(() => undefined);
	};

	return createServerSentEventResponse({
		signal: requestAlreadyAborted ? undefined : input.signal,
		heartbeatMs: input.heartbeatMs,
		maxLifetimeMs:
			input.maxLifetimeMs ?? WORKSPACE_EVENT_STREAM_MAX_LIFETIME_MS,
		onError: input.onError,
		start(stream) {
			let subscription: WorkspaceEventSubscription | null = null;
			if (requestAlreadyAborted) {
				stream.close();
				return () => cleanupWorkspaceEventStream(null, input.onClose);
			}
			try {
				subscription = input.subscriptions.subscribe({
					workspaceId: input.workspaceId,
					onReady() {
						stream.send({ event: "connected", data: {} });
					},
					onEvent(event) {
						stream.send({ event: "workspace-event", data: event });
					},
					onError(error) {
						reportError(error);
						stream.close();
					},
				});
			} catch (error) {
				reportError(error);
			}

			if (!subscription) stream.close();
			return () => cleanupWorkspaceEventStream(subscription, input.onClose);
		},
	});
}
