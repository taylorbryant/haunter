"use client";

import { authClient } from "@/client/auth-client";
import { canEditContent } from "@/lib/org-access";

/**
 * Whether the current member may edit content in the active workspace.
 * While the role is still loading this reports false, so write affordances
 * appear once confirmed instead of flashing and then vanishing. The server
 * enforces the same rule regardless.
 */
export function useCanEditWorkspace(): boolean {
	const member = authClient.useActiveMember();
	return member.isPending ? false : canEditContent(member.data?.role);
}
