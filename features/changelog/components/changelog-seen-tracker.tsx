"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { rq } from "@/client";
import { authClient } from "@/client/auth-client";
import { markChangelogSeenInCache } from "@/features/changelog/client/cache";
import { markChangelogSeen } from "@/features/changelog/contracts";

export function ChangelogSeenTracker({
	enabled = true,
}: {
	enabled?: boolean;
}) {
	const queryClient = useQueryClient();
	const { data: session, isPending } = authClient.useSession();
	const mutation = useMutation(
		rq(markChangelogSeen).mutationOptions({ meta: { errorMode: "silent" } }),
	);
	const started = useRef(false);

	useEffect(() => {
		if (!enabled || isPending || !session || started.current) return;
		started.current = true;
		mutation
			.mutateAsync({ body: {} })
			.then((result) => {
				markChangelogSeenInCache(queryClient, result.lastSeenVersion);
			})
			.catch(() => {
				// The changelog is public. Signed-out visitors should still be
				// able to read it; there is simply no per-user state to update.
			});
	}, [enabled, isPending, mutation, queryClient, session]);

	return null;
}
