"use client";

import { useAppSession } from "@/components/app-session-provider";
import { canEditContent } from "@/lib/org-access";

/**
 * Whether the current member may edit content in the active workspace.
 * While the role is still loading this reports false, so write affordances
 * appear once confirmed instead of flashing and then vanishing. The server
 * enforces the same rule regardless.
 */
export function useCanEditWorkspace(): boolean {
	const session = useAppSession();
	return canEditContent(session?.workspaceRole);
}
