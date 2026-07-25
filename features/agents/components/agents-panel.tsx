"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BotIcon,
	CircleCheckIcon,
	CircleXIcon,
	ExternalLinkIcon,
	PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Panel, PanelHeader } from "@/components/settings/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { disconnectAgentHost } from "@/features/agents/client/host-permissions";
import { disconnectRemoteMcpConnection } from "@/features/agents/client/mcp-connections";
import {
	invalidateAgentActivity,
	invalidateAgents,
	listAgentActivityQueryOptions,
	listAgentsQueryOptions,
} from "@/features/agents/client/queries";
import { AgentConnectDialog } from "@/features/agents/components/agent-connect-dialog";
import {
	AGENT_PERMISSION_PROFILES,
	agentCapabilityLabel,
	agentHostPermissionStateLabel,
} from "@/features/agents/permission-profiles";
import type {
	AgentActivity,
	AgentHostSummary,
	AgentSummary,
	McpConnectionSummary,
} from "@/features/agents/schemas";

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

function formatActivityDate(iso: string) {
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

const activityLabels: Record<string, string> = {
	list_workspaces: "Listed workspaces",
	list_pages: "Listed pages",
	search_pages: "Searched pages",
	read_page: "Read a page",
	create_page: "Created a page",
	append_to_page: "Updated a page",
	update_page: "Updated a page",
	archive_page: "Archived a page",
	restore_page: "Restored a page",
	list_tasks: "Listed tasks",
	create_task: "Created a task",
	update_task: "Updated a task",
	complete_task: "Completed a task",
	reopen_task: "Reopened a task",
	delete_task: "Deleted a task",
	list_workspace_members: "Listed workspace members",
};

function activityHref(activity: AgentActivity) {
	if (!activity.workspaceId || activity.status !== "success") return null;
	if (activity.capability === "archive_page") {
		return `/w/${activity.workspaceId}/trash`;
	}
	if (activity.resourceType === "page" && activity.resourceId) {
		return `/w/${activity.workspaceId}/p/${activity.resourceId}`;
	}
	if (activity.resourceType === "task") {
		return `/w/${activity.workspaceId}/tasks`;
	}
	return null;
}

function AgentActivityRow({ activity }: { activity: AgentActivity }) {
	const href = activityHref(activity);
	const label =
		activityLabels[activity.capability] ??
		activity.capability.replaceAll("_", " ");

	return (
		<div className="flex gap-3 border-b py-3 last:border-b-0">
			{activity.status === "success" ? (
				<CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			) : (
				<CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
					<span className="font-medium">
						{activity.status === "error" ? `Failed: ${label}` : label}
					</span>
					{activity.resourceLabel ? (
						href ? (
							<Link
								href={href}
								className="inline-flex min-w-0 items-center gap-1 text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
							>
								<span className="max-w-full truncate">
									{activity.resourceLabel}
								</span>
								<ExternalLinkIcon className="size-3 shrink-0" />
							</Link>
						) : (
							<span className="min-w-0 truncate text-muted-foreground">
								{activity.resourceLabel}
							</span>
						)
					) : null}
				</div>
				<p className="text-muted-foreground text-xs">
					{activity.agentName} · {formatActivityDate(activity.createdAt)} ·{" "}
					{activity.durationMs}ms
				</p>
				{activity.error ? (
					<p className="line-clamp-2 text-destructive text-xs">
						{activity.error}
					</p>
				) : null}
			</div>
		</div>
	);
}

function AgentActivityList() {
	const query = useQuery(listAgentActivityQueryOptions());

	return (
		<section className="flex flex-col gap-2">
			<div className="flex flex-col gap-1">
				<h3 className="font-medium text-sm">Recent activity</h3>
				<p className="text-muted-foreground text-xs">
					Capability executions from your connected agents.
				</p>
			</div>
			{query.isPending ? (
				<div className="flex flex-col gap-2 pt-1">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			) : query.isError && !query.data ? (
				<div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
					<p>Recent agent activity could not be loaded.</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void query.refetch()}
					>
						Try again
					</Button>
				</div>
			) : query.data.items.length === 0 ? (
				<p className="py-2 text-muted-foreground text-sm">
					No agent activity yet.
				</p>
			) : (
				<div>
					{query.data.items.map((activity) => (
						<AgentActivityRow key={activity.id} activity={activity} />
					))}
				</div>
			)}
		</section>
	);
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
							key={`${grant.capability}:${grant.workspaceScope ?? "global"}`}
							variant="secondary"
						>
							{agentCapabilityLabel(grant.capability)}
							{grant.workspaceScope ? ` · ${grant.workspaceScope}` : ""}
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

function AgentHostRow({
	host,
	onDisconnect,
}: {
	host: AgentHostSummary;
	onDisconnect: (host: AgentHostSummary) => void;
}) {
	const accessDescription =
		host.permissionProfile === "ask"
			? "Future agents from this client will ask you to approve access."
			: "This access is remembered for future agents from this client.";

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start">
			<BotIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="truncate font-medium text-sm">
						{host.name ?? "MCP client"}
					</span>
					<Badge variant="secondary">
						{agentHostPermissionStateLabel(host.permissionProfile)}
					</Badge>
				</div>
				<p className="text-muted-foreground text-xs">
					{accessDescription} Workspace membership and roles are still checked
					for every action.
				</p>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full sm:w-auto"
				onClick={() => onDisconnect(host)}
			>
				Disconnect
			</Button>
		</div>
	);
}

function McpConnectionRow({
	connection,
	onDisconnect,
}: {
	connection: McpConnectionSummary;
	onDisconnect: (connection: McpConnectionSummary) => void;
}) {
	const profile = AGENT_PERMISSION_PROFILES[connection.permissionProfile];
	const workspaceNames = connection.workspaces
		.map((workspace) => workspace.name)
		.join(", ");

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start">
			<BotIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="truncate font-medium text-sm">
						{connection.clientName ?? "MCP client"}
					</span>
					<Badge variant="secondary">{profile.label}</Badge>
					<Badge variant="outline">Hosted</Badge>
				</div>
				<p className="text-muted-foreground text-xs">
					{profile.description} Workspaces: {workspaceNames || "None"}.
				</p>
				<p className="text-muted-foreground text-xs">
					Connected {formatDate(connection.createdAt)}
					{connection.lastUsedAt
						? ` · last used ${formatDate(connection.lastUsedAt)}`
						: " · never used"}
				</p>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full sm:w-auto"
				onClick={() => onDisconnect(connection)}
			>
				Disconnect
			</Button>
		</div>
	);
}

/**
 * Settings panel for the user's AI agents: what's connected, what each one
 * may do, and revocation. Revocation goes through the agent-auth plugin's own
 * endpoints so grants are revoked and audit events emitted with it.
 */
export function AgentsPanel() {
	const queryClient = useQueryClient();
	const query = useQuery(listAgentsQueryOptions());
	const [connectOpen, setConnectOpen] = useState(false);
	const [revoking, setRevoking] = useState<AgentSummary | null>(null);
	const [disconnecting, setDisconnecting] = useState<AgentHostSummary | null>(
		null,
	);
	const [disconnectingRemote, setDisconnectingRemote] =
		useState<McpConnectionSummary | null>(null);
	const revoke = useMutation({
		mutationFn: revokeAgent,
		meta: { errorMode: "inline" },
		onSuccess: () => {
			setRevoking(null);
			void invalidateAgents(queryClient);
		},
	});
	const disconnect = useMutation({
		mutationFn: (hostId: string) => disconnectAgentHost(hostId),
		meta: { errorMode: "inline" },
		onSuccess: () => {
			setDisconnecting(null);
			void invalidateAgents(queryClient);
		},
	});
	const disconnectRemote = useMutation({
		mutationFn: disconnectRemoteMcpConnection,
		meta: { errorMode: "inline" },
		onSuccess: () => {
			setDisconnectingRemote(null);
			void invalidateAgents(queryClient);
			void invalidateAgentActivity(queryClient);
		},
	});

	function confirmRevokeAgent() {
		if (!revoking || revoke.isPending) return;
		revoke.mutate(revoking.id);
	}

	function openRevokeAgent(agent: AgentSummary) {
		revoke.reset();
		setRevoking(agent);
	}

	function confirmDisconnectHost() {
		if (!disconnecting || disconnect.isPending) return;
		disconnect.mutate(disconnecting.id);
	}

	function openDisconnectHost(host: AgentHostSummary) {
		disconnect.reset();
		setDisconnecting(host);
	}

	function confirmDisconnectRemote() {
		if (!disconnectingRemote || disconnectRemote.isPending) return;
		disconnectRemote.mutate(disconnectingRemote.id);
	}

	function openDisconnectRemote(connection: McpConnectionSummary) {
		disconnectRemote.reset();
		setDisconnectingRemote(connection);
	}

	return (
		<Panel>
			<PanelHeader
				title="Agents"
				description="Control which AI clients and agents can act on your behalf in Haunter."
			/>
			<section className="flex flex-col items-start gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h3 className="font-medium text-sm">Connect an agent</h3>
					<p className="text-muted-foreground text-xs">
						Get setup instructions for Codex, Claude, Cursor, VS Code, and other
						MCP clients.
					</p>
				</div>
				<Button
					type="button"
					className="w-full sm:w-auto"
					onClick={() => setConnectOpen(true)}
				>
					<PlusIcon data-icon="inline-start" />
					Connect
				</Button>
			</section>
			<section className="flex flex-col gap-2">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-sm">Connected clients</h3>
					<p className="text-muted-foreground text-xs">
						Access profiles are chosen during approval. Disconnect a client to
						remove it and all of its agents.
					</p>
				</div>
				{query.isPending ? (
					<Skeleton className="h-20 w-full" />
				) : query.isError && !query.data ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<span className="flex-1">Your clients could not be loaded.</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void query.refetch()}
						>
							Try again
						</Button>
					</div>
				) : query.data.hosts.length === 0 &&
					query.data.mcpConnections.length === 0 ? (
					<div className="rounded-md border border-dashed p-4">
						<p className="text-muted-foreground text-sm">
							No clients connected yet.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{query.data.mcpConnections.map((connection) => (
							<McpConnectionRow
								key={connection.id}
								connection={connection}
								onDisconnect={openDisconnectRemote}
							/>
						))}
						{query.data.hosts.map((host) => (
							<AgentHostRow
								key={host.id}
								host={host}
								onDisconnect={openDisconnectHost}
							/>
						))}
					</div>
				)}
			</section>
			<section className="flex flex-col gap-2">
				<div className="flex flex-col gap-1">
					<h3 className="font-medium text-sm">Agents</h3>
					<p className="text-muted-foreground text-xs">
						Review current and previous agents, or revoke one individually.
					</p>
				</div>
				{query.isPending ? (
					<div className="flex flex-col gap-2">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-20 w-full" />
					</div>
				) : query.isError && !query.data ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<span className="flex-1">Your agents could not be loaded.</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void query.refetch()}
						>
							Try again
						</Button>
					</div>
				) : query.data.items.length === 0 ? (
					<div className="rounded-md border border-dashed p-4">
						<p className="text-muted-foreground text-sm">
							No agents connected yet.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{query.data.items.map((agent) => (
							<AgentRow
								key={agent.id}
								agent={agent}
								onRevoke={openRevokeAgent}
							/>
						))}
					</div>
				)}
			</section>
			<AgentActivityList />
			<DestructiveConfirmationDialog
				open={disconnectingRemote !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDisconnectingRemote(null);
						disconnectRemote.reset();
					}
				}}
				title={`Disconnect “${disconnectingRemote?.clientName ?? "MCP client"}”?`}
				description="This client loses access immediately, including any active tokens. To use it again, reconnect and choose an access profile and workspaces."
				actionLabel="Disconnect client"
				pendingLabel="Disconnecting…"
				pending={disconnectRemote.isPending}
				error={
					disconnectRemote.isError
						? disconnectRemote.error instanceof Error
							? disconnectRemote.error.message
							: "Could not disconnect this client."
						: null
				}
				onConfirm={confirmDisconnectRemote}
			/>
			<DestructiveConfirmationDialog
				open={disconnecting !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDisconnecting(null);
						disconnect.reset();
					}
				}}
				title={`Disconnect “${disconnecting?.name ?? "MCP client"}”?`}
				description="The client and every agent it created lose access immediately. To use this client again, reconnect it and approve a new access profile."
				actionLabel="Disconnect client"
				pendingLabel="Disconnecting…"
				pending={disconnect.isPending}
				error={
					disconnect.isError
						? disconnect.error instanceof Error
							? disconnect.error.message
							: "Could not disconnect this client."
						: null
				}
				onConfirm={confirmDisconnectHost}
			/>
			<DestructiveConfirmationDialog
				open={revoking !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRevoking(null);
						revoke.reset();
					}
				}}
				title={`Revoke “${revoking?.name ?? "agent"}”?`}
				description="The agent loses all capabilities immediately and its tokens stop working. This cannot be undone; the agent would have to register and be approved again."
				actionLabel="Revoke agent"
				pendingLabel="Revoking…"
				pending={revoke.isPending}
				error={
					revoke.isError
						? revoke.error instanceof Error
							? revoke.error.message
							: "Could not revoke this agent."
						: null
				}
				onConfirm={confirmRevokeAgent}
			/>
			<AgentConnectDialog
				open={connectOpen}
				onOpenChange={setConnectOpen}
				resourceUrl={query.data?.mcpResourceUrl ?? ""}
			/>
		</Panel>
	);
}
