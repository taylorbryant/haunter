"use client";
import { useQuery } from "@tanstack/react-query";
import { rq } from "@/client";
import { useAppSession } from "@/components/app-session-provider";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { listWorkspaceMembers } from "../contracts";

/** Uses the current web or embedded credential, scoped to the active workspace. */
export function useWorkspaceMembers() {
	const workspaceId = useAppSession()?.activeWorkspaceId;
	const enabled = useProtectedRequestsEnabled();
	return useQuery({
		...rq(listWorkspaceMembers).queryOptions({
			path: { workspaceId: workspaceId ?? "" },
		}),
		enabled: enabled && !!workspaceId,
		meta: { errorMode: "inline" },
	});
}
