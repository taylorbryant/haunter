"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
	getPendingAgentQueryOptions,
	invalidateAgents,
} from "@/features/agents/client/queries";

type Phase = "review" | "working" | "approved" | "denied" | "failed";

async function decideCapabilityRequest(body: {
	approval_id: string;
	action: "approve" | "deny";
	user_code?: string;
	capabilities?: string[];
}): Promise<{ ok: boolean; message?: string }> {
	const res = await fetch("/api/auth/agent/approve-capability", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = (await res.json().catch(() => null)) as {
		error?: string;
		message?: string;
	} | null;
	// The plugin can send soft failures (e.g. fresh_session_required) with a
	// 200 status, so an `error` field in the body means failure regardless.
	if (res.ok && !payload?.error) return { ok: true };
	return {
		ok: false,
		message: payload?.message ?? "The approval could not be completed.",
	};
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
	const [excluded, setExcluded] = useState<Set<string>>(new Set());
	const [phase, setPhase] = useState<Phase>("review");
	const [error, setError] = useState("");

	async function decide(action: "approve" | "deny") {
		if (!query.data) return;
		setPhase("working");
		setError("");
		const requested =
			query.data?.requestedCapabilities.map((c) => c.name) ?? [];
		const approvedCapabilities = requested.filter(
			(name) => !excluded.has(name),
		);
		const result = await decideCapabilityRequest({
			approval_id: query.data.approvalId,
			action,
			...(action === "approve"
				? { user_code: code.trim(), capabilities: approvedCapabilities }
				: {}),
		});
		if (!result.ok) {
			setPhase("failed");
			setError(result.message ?? "");
			return;
		}
		await invalidateAgents(queryClient);
		setPhase(action === "approve" ? "approved" : "denied");
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

	if (query.isError) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Nothing to approve</CardTitle>
					<CardDescription>
						This agent request has expired, was already decided, or the link is
						invalid.
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

	const agent = query.data;

	if (phase === "approved" || phase === "denied") {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>
						{phase === "approved" ? "Agent approved" : "Agent denied"}
					</CardTitle>
					<CardDescription>
						{phase === "approved"
							? `"${agent.name}" can now act on your behalf with the capabilities you granted. You can revoke it anytime from Settings → Agents.`
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
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 font-medium text-sm">
						Requested capabilities
					</legend>
					{agent.requestedCapabilities.map((capability) => (
						<Label
							key={capability.name}
							className="flex items-start gap-3 rounded-md border p-3 font-normal"
						>
							<Checkbox
								checked={!excluded.has(capability.name)}
								onCheckedChange={(checked) => {
									setExcluded((prev) => {
										const next = new Set(prev);
										if (checked === true) next.delete(capability.name);
										else next.add(capability.name);
										return next;
									});
								}}
							/>
							<span className="flex min-w-0 flex-col gap-1">
								<span className="font-medium font-mono text-sm">
									{capability.name}
								</span>
								{capability.workspaceScope ? (
									<span className="text-foreground text-xs">
										Workspace: {capability.workspaceScope}
									</span>
								) : null}
								<span className="text-muted-foreground text-sm">
									{capability.description}
								</span>
							</span>
						</Label>
					))}
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
						excluded.size === agent.requestedCapabilities.length
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
