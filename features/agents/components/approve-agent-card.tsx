"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { reportUserError } from "@/client/error-feedback";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberAgentHostPermissionProfile } from "@/features/agents/client/host-permissions";
import {
	getPendingAgentQueryOptions,
	invalidateAgents,
} from "@/features/agents/client/queries";
import {
	AGENT_PERMISSION_PROFILES,
	type AgentPermissionProfile,
	agentHostPermissionStateLabel,
	agentPermissionProfilesAtOrAbove,
} from "@/features/agents/permission-profiles";
import { cn } from "@/lib/utils";

function formatList(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

type Phase =
	| "review"
	| "working"
	| "approved"
	| "denied"
	| "failed"
	| "remember-failed";

async function decideCapabilityRequest(body: {
	approval_id: string;
	action: "approve" | "deny";
	user_code?: string;
	capabilities?: string[];
}): Promise<{ ok: boolean; message?: string }> {
	try {
		const res = await fetch("/api/auth/agent/approve-capability", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const payload = (await res.json().catch(() => null)) as {
			error?: string | { message?: string };
			message?: string;
		} | null;
		// The plugin can send soft failures (e.g. fresh_session_required) with a
		// 200 status, so an `error` field in the body means failure regardless.
		if (res.ok && !payload?.error) return { ok: true };
		return {
			ok: false,
			message:
				(typeof payload?.error === "object"
					? payload.error.message
					: payload?.message) ?? "The approval could not be completed.",
		};
	} catch {
		return {
			ok: false,
			message:
				"The approval could not be completed. Check your connection and try again.",
		};
	}
}

/**
 * Device-authorization approval (Agent Auth Protocol §6): the agent hands its
 * user a link with its agent id and a short user code; this card shows what
 * the agent is asking for and submits the decision with the code. The code —
 * not this page — is the proof the approver holds the agent's handoff.
 */
export function ApproveAgentCard({
	agentId,
	initialCode,
}: {
	agentId: string;
	initialCode: string;
}) {
	const queryClient = useQueryClient();
	const query = useQuery(getPendingAgentQueryOptions(agentId));
	const [code, setCode] = useState(initialCode);
	const [selectedProfile, setSelectedProfile] =
		useState<AgentPermissionProfile | null>(null);
	const [phase, setPhase] = useState<Phase>("review");
	const [error, setError] = useState("");

	async function decide(action: "approve" | "deny") {
		if (!query.data) return;
		const profile =
			selectedProfile ?? query.data.minimumPermissionProfile ?? null;
		if (action === "approve" && !profile) return;
		setPhase("working");
		setError("");
		const requested =
			query.data?.requestedCapabilities.map((c) => c.name) ?? [];
		const result = await decideCapabilityRequest({
			approval_id: query.data.approvalId,
			action,
			...(action === "approve"
				? { user_code: code.trim(), capabilities: requested }
				: {}),
		});
		if (!result.ok) {
			setPhase("failed");
			setError(result.message ?? "");
			return;
		}
		if (action === "approve" && profile) {
			try {
				await rememberAgentHostPermissionProfile({
					hostId: query.data.hostId,
					profile,
				});
			} catch (rememberError) {
				setPhase("remember-failed");
				setError(
					rememberError instanceof Error
						? rememberError.message
						: "The agent was approved, but its access profile could not be applied.",
				);
				void invalidateAgents(queryClient);
				return;
			}
		}
		void invalidateAgents(queryClient).catch((refreshError) => {
			reportUserError(
				refreshError,
				"The decision was saved, but the agent list could not be refreshed.",
			);
		});
		setPhase(action === "approve" ? "approved" : "denied");
	}

	async function retryRememberingAccess() {
		if (!query.data) return;
		const profile =
			selectedProfile ?? query.data.minimumPermissionProfile ?? null;
		if (!profile) return;
		setPhase("working");
		setError("");
		try {
			await rememberAgentHostPermissionProfile({
				hostId: query.data.hostId,
				profile,
			});
			await invalidateAgents(queryClient);
			setPhase("approved");
		} catch (rememberError) {
			setPhase("remember-failed");
			setError(
				rememberError instanceof Error
					? rememberError.message
					: "The access profile could not be applied.",
			);
		}
	}

	if (query.isPending) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (query.isError && !query.data) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Approval unavailable</CardTitle>
					<CardDescription>
						This agent request has expired, was already decided, or the link is
						invalid.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button variant="outline" onClick={() => void query.refetch()}>
						Try again
					</Button>
					<Button
						variant="ghost"
						render={<Link href="/" />}
						nativeButton={false}
					>
						Back to Haunter
					</Button>
				</CardFooter>
			</Card>
		);
	}

	const agent = query.data;
	const effectiveProfile =
		selectedProfile ?? agent.minimumPermissionProfile ?? null;
	const availableProfiles = agent.minimumPermissionProfile
		? agentPermissionProfilesAtOrAbove(agent.minimumPermissionProfile)
		: [];
	const requestedWorkspaces = [
		...new Set(
			agent.requestedCapabilities.flatMap(({ workspaceScope }) =>
				workspaceScope ? [workspaceScope] : [],
			),
		),
	];
	const includesGeneralAccess = agent.requestedCapabilities.some(
		({ workspaceScope }) => workspaceScope === null,
	);

	if (phase === "approved" || phase === "denied") {
		const approvedProfile = effectiveProfile
			? AGENT_PERMISSION_PROFILES[effectiveProfile]
			: null;
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>
						{phase === "approved" ? "Agent approved" : "Agent denied"}
					</CardTitle>
					<CardDescription>
						{phase === "approved"
							? `"${agent.name}" is approved. ${approvedProfile?.label ?? "This access"} is now remembered for future agents from ${agent.hostName ?? "this client"}. You can disconnect the client from Settings → Agents.`
							: `"${agent.name}" was denied and cannot access your workspaces.`}
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button
						variant="outline"
						render={<Link href="/" />}
						nativeButton={false}
					>
						Back to Haunter
					</Button>
				</CardFooter>
			</Card>
		);
	}

	if (phase === "remember-failed") {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Agent approved</CardTitle>
					<CardDescription>
						The current agent can continue, but Haunter could not finish
						applying the selected access profile to{" "}
						{agent.hostName ?? "this client"}.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				</CardContent>
				<CardFooter className="gap-2">
					<Button onClick={() => void retryRememberingAccess()}>
						Try again
					</Button>
					<Button
						variant="outline"
						render={<Link href="/" />}
						nativeButton={false}
					>
						Back to Haunter
					</Button>
				</CardFooter>
			</Card>
		);
	}

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<div className="flex items-center gap-2">
					<BotIcon className="size-5 text-muted-foreground" />
					<CardTitle>{agent.name}</CardTitle>
				</div>
				<CardDescription>
					{agent.hostName ? `From ${agent.hostName}. ` : ""}This AI agent is
					asking to act on your behalf. Only approve agents you connected
					yourself.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<section
					aria-labelledby="current-agent-request"
					className="rounded-md border bg-muted/30 p-3"
				>
					<h2 id="current-agent-request" className="font-medium text-sm">
						Current request
					</h2>
					{requestedWorkspaces.length > 0 ? (
						<p className="mt-1 text-muted-foreground text-sm">
							Workspaces:{" "}
							<span className="font-medium text-foreground">
								{formatList(requestedWorkspaces)}
							</span>
						</p>
					) : (
						<p className="mt-1 text-muted-foreground text-sm">
							No workspace-specific access is requested.
						</p>
					)}
					{includesGeneralAccess ? (
						<p className="mt-1 text-muted-foreground text-xs">
							This also includes general access needed to find your workspaces.
						</p>
					) : null}
				</section>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 font-medium text-sm">
						{agent.currentPermissionProfile === "ask"
							? "Choose access"
							: agent.currentPermissionProfile ===
									agent.minimumPermissionProfile
								? "Confirm access"
								: "Upgrade access"}
					</legend>
					{agent.currentPermissionProfile !== "ask" ? (
						<p className="mb-2 text-muted-foreground text-sm">
							Current access:{" "}
							<span className="font-medium text-foreground">
								{agentHostPermissionStateLabel(agent.currentPermissionProfile)}
							</span>
						</p>
					) : null}
					{availableProfiles.map((profile) => {
						const definition = AGENT_PERMISSION_PROFILES[profile];
						const selected = effectiveProfile === profile;
						return (
							<Label
								key={profile}
								className={cn(
									"flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors",
									selected
										? "border-primary bg-primary/5"
										: "hover:bg-muted/50",
								)}
							>
								<input
									type="radio"
									name="agent-permission-profile"
									value={profile}
									checked={selected}
									onChange={() => setSelectedProfile(profile)}
									className="mt-1 size-4 accent-primary"
								/>
								<span className="flex min-w-0 flex-col gap-1">
									<span className="font-medium text-sm">
										{definition.label}
									</span>
									<span className="text-muted-foreground text-sm">
										{definition.description}
									</span>
									<ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground text-xs">
										{definition.details.map((detail) => (
											<li key={detail}>{detail}</li>
										))}
									</ul>
								</span>
							</Label>
						);
					})}
					{agent.minimumPermissionProfile === null ? (
						<p
							role="alert"
							className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm"
						>
							This request includes access this version of Haunter cannot safely
							classify. Deny it and update the client before trying again.
						</p>
					) : null}
					<p className="mt-2 text-muted-foreground text-xs">
						This approval grants only the access in the current request. Haunter
						remembers which requests future agents from{" "}
						{agent.hostName ?? "this client"} may receive without another
						approval. Membership and roles are still checked for every action.
					</p>
				</fieldset>
				<div className="flex flex-col gap-2">
					<Label htmlFor="agent-user-code">Confirmation code</Label>
					<Input
						id="agent-user-code"
						value={code}
						onChange={(event) => setCode(event.target.value)}
						placeholder="XXXX-XXXX"
						autoComplete="off"
						className="font-mono uppercase"
					/>
					<p className="text-muted-foreground text-xs">
						The code shown by the agent that sent you here. It proves you're
						approving the right request.
					</p>
				</div>
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
			</CardContent>
			<CardFooter className="gap-2">
				<Button
					onClick={() => decide("approve")}
					disabled={
						phase === "working" ||
						code.trim().length === 0 ||
						effectiveProfile === null
					}
				>
					<CheckIcon data-icon="inline-start" />
					Approve
				</Button>
				<Button
					variant="outline"
					onClick={() => decide("deny")}
					disabled={phase === "working"}
				>
					<XIcon data-icon="inline-start" />
					Deny
				</Button>
			</CardFooter>
		</Card>
	);
}
