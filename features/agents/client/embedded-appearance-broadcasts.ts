import type { BroadcastClient } from "@beignet/core/broadcasting/client";
import {
	createBroadcastMutationRefreshGate,
	createBroadcastQuerySubscription,
} from "@beignet/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { embeddedAppearanceChanges } from "../channels";
import { getEmbeddedAppearance } from "../contracts";
import { EMBEDDED_APPEARANCE_WRITE_KEY } from "./embedded-appearance";

export function subscribeToEmbeddedAppearanceChanges(input: {
	client: BroadcastClient;
	queryClient: QueryClient;
	userId: string;
	onError?(error: unknown): void;
}) {
	const queries = [rq(getEmbeddedAppearance).filter()];
	return createBroadcastQuerySubscription({
		...input,
		channel: embeddedAppearanceChanges,
		params: { userId: input.userId },
		invalidates: () => queries,
		reconciles: queries,
		refreshGate: createBroadcastMutationRefreshGate({
			queryClient: input.queryClient,
			mutations: { mutationKey: EMBEDDED_APPEARANCE_WRITE_KEY },
		}),
	});
}
