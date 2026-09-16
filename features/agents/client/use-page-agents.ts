"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type CachedPageAgentActivity,
	pageAgentActivityKey,
	visiblePageAgents,
} from "./page-activity-cache";

const empty: CachedPageAgentActivity[] = [];

export function usePageAgents(
	userId: string,
	workspaceId: string,
	pageId: string,
) {
	const { data = empty } = useQuery({
		queryKey: pageAgentActivityKey(userId, workspaceId),
		queryFn: () => empty,
		enabled: false,
		staleTime: Infinity,
	});
	const [, tick] = useState(0);
	const now = performance.now();
	const agents = visiblePageAgents(data, pageId, now);
	const nextExpiry = Math.min(
		...data
			.filter((item) => item.pageId === pageId)
			.map((item) => item.expiresAt)
			.filter((expiresAt) => expiresAt > now),
	);
	useEffect(() => {
		if (!Number.isFinite(nextExpiry)) return;
		const timer = setTimeout(
			() => tick((value) => value + 1),
			Math.max(1, Math.ceil(nextExpiry - performance.now())),
		);
		return () => clearTimeout(timer);
	}, [nextExpiry]);
	return agents;
}
