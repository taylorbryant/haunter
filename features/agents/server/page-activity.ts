import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import type { PageAgentActivity } from "@/features/agents/page-activity";
import type { AgentPrincipal } from "@/lib/agent-capabilities";
import { requireActiveWorkspaceScope } from "@/lib/auth";

const actions: Record<string, PageAgentActivity["action"]> = {
	read_page: "read",
	append_to_page: "append",
	update_page: "update",
	archive_page: "archive",
	restore_page: "restore",
};

const PRESENCE_TIMEOUT_MS = 1_000;

/** Presence is best effort and must never hold up an MCP call indefinitely. */
async function publish(
	ctx: AppContext,
	event: PageAgentActivity,
	timeoutMs = PRESENCE_TIMEOUT_MS,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			ctx.ports.workspaceEvents.publish(event),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			}),
		]);
	} catch {
		// The authoritative operation and its audit trail remain independent.
	} finally {
		clearTimeout(timer);
	}
}

/** Called after capability grants and current workspace membership are checked. */
export async function startPageAgentActivity(input: {
	ctx: AppContext;
	principal: AgentPrincipal;
	capability: string;
	args: Record<string, unknown> | undefined;
}): Promise<((phase: "completed" | "failed") => Promise<void>) | undefined> {
	const { ctx, principal, args } = input;
	const action = actions[input.capability];
	if (
		principal.transport !== "remote-mcp" ||
		!principal.remoteConnectionId ||
		!action ||
		typeof args?.pageId !== "string" ||
		typeof args.workspaceId !== "string" ||
		!ctx.ports.workspaceEventSubscriptions.isConfigured()
	)
		return;

	const workspaceId = args.workspaceId;
	const pageId = args.pageId;
	const agentId = principal.remoteConnectionId;
	const controller = new AbortController();
	const deadline = performance.now() + PRESENCE_TIMEOUT_MS;
	const expired = () =>
		controller.signal.aborted || performance.now() >= deadline;
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Preparation only returns data. If an uncancellable repository call finishes
	// after the deadline, it cannot publish or begin another presence lookup.
	async function prepare(): Promise<PageAgentActivity | undefined> {
		const scope = requireActiveWorkspaceScope(ctx, workspaceId);
		const page = await ctx.ports.pages.findMetaById(scope, pageId);
		if (expired() || !page || (page.deletedAt !== null && action !== "restore"))
			return;
		await ctx.gate.authorize(
			action === "read"
				? "pages.read"
				: action === "archive"
					? "pages.delete"
					: "pages.update",
			page,
		);
		if (expired()) return;
		const members = await ctx.ports.members.listByWorkspace(scope);
		if (expired()) return;
		const owner = members.find((member) => member.userId === principal.userId);
		if (!owner) return;
		const now = new Date().toISOString();
		return {
			schemaVersion: 1,
			type: "agent.pageActivity",
			workspaceId: page.workspaceId,
			pageId: page.id,
			operationId: crypto.randomUUID(),
			agentId,
			agentName:
				principal.remoteClientName?.trim().slice(0, 100) || "MCP agent",
			userId: principal.userId,
			userName: owner.name.trim().slice(0, 100) || "Workspace member",
			action,
			phase: "active",
			startedAt: now,
			occurredAt: now,
		};
	}

	try {
		const timeout = new Promise<undefined>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve(undefined);
			}, PRESENCE_TIMEOUT_MS);
		});
		const event = await Promise.race([prepare(), timeout]);
		const remainingMs = deadline - performance.now();
		if (!event || expired() || remainingMs <= 0) return;
		await publish(ctx, event, remainingMs);
		// Publication may already be in flight when its budget runs out. Keep the
		// completion callback so that attempt still receives a terminal event.
		return (phase) =>
			publish(ctx, { ...event, phase, occurredAt: new Date().toISOString() });
	} catch {
		// The capability's use case still performs its own authoritative checks.
		return;
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}
