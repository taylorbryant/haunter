"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useState } from "react";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Panel, PanelHeader } from "@/components/settings/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	invalidateAgents,
	listAgentsQueryOptions,
} from "@/features/agents/client/queries";
import type { AgentSummary } from "@/features/agents/schemas";

function statusVariant(status: string) {
	if (status === "active") return "default" as const;
	if (status === "pending") return "secondary" as const;
	return "outline" as const;
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

async function revokeAgent(agentId: string) {
	const res = await fetch("/api/auth/agent/revoke", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ agent_id: agentId }),
	});
	if (!res.ok) {
		const payload = (await res.json().catch(() => null)) as {
			message?: string;
		} | null;
		throw new Error(payload?.message ?? "Could not revoke this agent.");
	}
}

function AgentRow({
	agent,
	onRevoke,
}: {
	agent: AgentSummary;
	onRevoke: (agent: AgentSummary) => void;
}) {
	const activeGrants = agent.grants.filter((g) => g.status === "active");
	const revocable = agent.status === "active" || agent.status === "pending";

	return (
		<div className="flex flex-col gap-2 rounded-md border p-3">
			<div className="flex items-center gap-2">
				<BotIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 truncate font-medium text-sm">
					{agent.name}
				</span>
				<Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
				<span className="flex-1" />
				{revocable ? (
					<Button size="sm" variant="outline" onClick={() => onRevoke(agent)}>
						Revoke
					</Button>
				) : null}
			</div>
			{activeGrants.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{activeGrants.map((grant) => (
						<Badge
							key={grant.capability}
							variant="secondary"
							className="font-mono"
						>
							{grant.capability}
						</Badge>
					))}
				</div>
			) : null}
			<p className="text-muted-foreground text-xs">
				{agent.hostName ? `${agent.hostName} · ` : ""}
				connected {formatDate(agent.createdAt)}
				{agent.lastUsedAt
					? ` · last used ${formatDate(agent.lastUsedAt)}`
					: " · never used"}
			</p>
		</div>
	);
}

/**
 * Settings panel for the user's AI agents: what's connected, what each one
 * may do, and revocation. Revoke goes through the agent-auth plugin's own
 * endpoint so grants are revoked and audit events emitted with it.
 */
export function AgentsPanel() {
	const queryClient = useQueryClient();
	const query = useQuery(listAgentsQueryOptions());
	const [revoking, setRevoking] = useState<AgentSummary | null>(null);
	const revoke = useMutation({
		mutationFn: revokeAgent,
		onSettled: () => invalidateAgents(queryClient),
	});

	function confirmRevokeAgent() {
		if (!revoking || revoke.isPending) return;
		revoke.mutate(revoking.id, {
			onSettled: () => setRevoking(null),
		});
	}

	return (
		<Panel>
			<PanelHeader
				title="Agents"
				description="AI agents you've approved to read and write your pages. Each agent acts as you, limited to the capabilities you granted."
			/>
			{query.isPending ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-20 w-full" />
					<Skeleton className="h-20 w-full" />
				</div>
			) : query.isError ? (
				<p className="text-muted-foreground text-sm">
					Your agents could not be loaded. Try again in a moment.
				</p>
			) : query.data.items.length === 0 ? (
				<div className="flex flex-col gap-2 rounded-md border border-dashed p-4">
					<p className="font-medium text-sm">No agents connected</p>
					<p className="text-muted-foreground text-sm">
						Point an Agent Auth-compatible client at this app's discovery
						document (
						<code className="font-mono">/.well-known/agent-configuration</code>
						). When it registers, it will give you an approval link to review
						what it's asking for.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{query.data.items.map((agent) => (
						<AgentRow key={agent.id} agent={agent} onRevoke={setRevoking} />
					))}
				</div>
			)}
			{revoke.isError ? (
				<p className="text-destructive text-sm">
					{revoke.error instanceof Error
						? revoke.error.message
						: "Could not revoke this agent."}
				</p>
			) : null}
			<DestructiveConfirmationDialog
				open={revoking !== null}
				onOpenChange={(open) => {
					if (!open) setRevoking(null);
				}}
				title={`Revoke “${revoking?.name ?? "agent"}”?`}
				description="The agent loses all capabilities immediately and its tokens stop working. This cannot be undone; the agent would have to register and be approved again."
				actionLabel="Revoke agent"
				pendingLabel="Revoking…"
				pending={revoke.isPending}
				onConfirm={confirmRevokeAgent}
			/>
		</Panel>
	);
}
