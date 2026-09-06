import { canEditContent } from "@/lib/org-roles";
import {
	WorkspaceAccessError,
	WorkspaceSelectionError,
	type VerifiedSession,
} from "./session-recovery";

type BrowserSession = {
	user: { id: string };
	session: { activeOrganizationId?: string | null };
	needsRefresh?: boolean;
};

async function authRequest(
	path: string,
	signal: AbortSignal,
	body?: object,
): Promise<unknown> {
	const response = await fetch(`/api/auth/${path}`, {
		method: body ? "POST" : "GET",
		signal,
		credentials: "same-origin",
		cache: "no-store",
		...(body
			? {
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}
			: {}),
	});
	if (!response.ok) {
		if (response.status === 401) return null;
		if (
			path.startsWith("organization/") &&
			(response.status === 403 || response.status === 400)
		)
			throw new WorkspaceAccessError();
		throw new Error("Session verification failed");
	}
	return response.json();
}

/** Own the complete deferred-refresh protocol so a failed POST cannot look like
 * a successful GET. Ordinary checks also bypass stale identity/role cookies. */
export async function verifyBrowserSession(input: {
	userId: string;
	workspaceId: string | null;
	requireEdit: boolean;
	recover: boolean;
	signal: AbortSignal;
}): Promise<VerifiedSession | null> {
	const { signal } = input;
	let session = (await authRequest(
		"get-session?disableCookieCache=true",
		signal,
	)) as BrowserSession | null;
	if (session?.needsRefresh)
		session = (await authRequest(
			// The preceding GET may have set a session-data cookie. Bypass it so
			// this POST actually renews the database session and token cookie.
			"get-session?disableCookieCache=true",
			signal,
			{},
		)) as BrowserSession | null;
	if (!session?.user || !session.session) return null;
	if (session.user.id !== input.userId)
		return { userId: session.user.id, workspaceId: null, role: null };
	const workspaceId = input.workspaceId;
	if (!workspaceId)
		return { userId: session.user.id, workspaceId: null, role: null };
	if (session.session.activeOrganizationId !== workspaceId) {
		// A different tab may have selected another workspace. Recovery owns this
		// activation; normal route transitions keep using the existing route sync.
		if (!input.recover) throw new WorkspaceSelectionError();
		const active = await authRequest("organization/set-active", signal, {
			organizationId: workspaceId,
		});
		if (!active) return null;
	}
	const member = (await authRequest(
		"organization/get-active-member",
		signal,
	)) as { userId: string; organizationId: string; role: string } | null;
	if (!member) return null;
	if (
		member.userId !== input.userId ||
		member.organizationId !== workspaceId ||
		(input.requireEdit && !canEditContent(member.role))
	)
		throw new WorkspaceAccessError();
	return { userId: session.user.id, workspaceId, role: member.role };
}
