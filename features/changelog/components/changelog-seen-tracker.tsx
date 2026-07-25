"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authClient } from "@/client/auth-client";
import {
	markChangelogSeenInCache,
	markChangelogSeenMutationOptions,
} from "@/features/changelog/client/queries";

export function ChangelogSeenTracker() {
	const queryClient = useQueryClient();
	const { data: session, isPending } = authClient.useSession();
	const mutation = useMutation({
		...markChangelogSeenMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const started = useRef(false);

	useEffect(() => {
		if (isPending || !session || started.current) return;
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
	}, [isPending, mutation, queryClient, session]);

	return null;
}
