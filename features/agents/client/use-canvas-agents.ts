"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type CachedCanvasAgentActivity,
	canvasAgentActivityKey,
	canvasActivitySnapshot,
} from "./canvas-activity-cache";

const empty: CachedCanvasAgentActivity[] = [];
export function useCanvasAgents(
	userId: string,
	workspaceId: string,
	canvasId: string,
) {
	const { data = empty } = useQuery({
		queryKey: canvasAgentActivityKey(userId, workspaceId),
		queryFn: () => empty,
		enabled: false,
		staleTime: Infinity,
	});
	const [, tick] = useState(0);
	const snapshot = canvasActivitySnapshot(data, canvasId);
	useEffect(() => {
		if (!Number.isFinite(snapshot.nextExpiry)) return;
		const timer = setTimeout(
			() => tick((value) => value + 1),
			Math.max(1, Math.ceil(snapshot.nextExpiry - performance.now())),
		);
		return () => clearTimeout(timer);
	}, [snapshot.nextExpiry]);
	return snapshot;
}
