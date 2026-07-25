"use client";

import { BotIcon, ExternalLinkIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/client";
import { authClient } from "@/client/auth-client";
import { authErrorMessage } from "@/client/error-feedback";
import { GhostLogo } from "@/components/ghost-logo";
import { Badge } from "@/components/ui/badge";
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
import {
	authorizeMcpConnection,
	getMcpConsentContext,
} from "@/features/agents/contracts";
import {
	AGENT_PERMISSION_PROFILE_IDS,
	AGENT_PERMISSION_PROFILES,
	type AgentPermissionProfile,
} from "@/features/agents/permission-profiles";
import type { McpConsentContext } from "@/features/agents/schemas";
import { useWorkspaces } from "@/features/workspaces/client/use-workspaces";
import { cn } from "@/lib/utils";

export function McpConsentCard() {
	const searchParams = useSearchParams();
	const clientId = searchParams.get("client_id") ?? "";
	const oauthQuery = searchParams.toString();
	const workspacesQuery = useWorkspaces();
	const [client, setClient] = useState<McpConsentContext | null>(null);
	const [clientError, setClientError] = useState("");
	const [profile, setProfile] = useState<AgentPermissionProfile>("view");
	const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>(
		[],
	);
	const [pendingAction, setPendingAction] = useState<"approve" | "deny" | null>(
		null,
	);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!clientId) {
			setClientError("This authorization request is missing a client.");
			return;
		}
		setClient(null);
		setClientError("");
		setProfile("view");
		setSelectedWorkspaceIds([]);
		let cancelled = false;
		void apiClient
			.endpoint(getMcpConsentContext)
			.call({ body: { oauthQuery } })
			.then((result) => {
				if (cancelled) return;
				setClient(result);
			})
			.catch(() => {
				if (!cancelled) {
					setClientError("This MCP authorization request is not valid.");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [clientId, oauthQuery]);

	const selectedWorkspaceSet = useMemo(
		() => new Set(selectedWorkspaceIds),
		[selectedWorkspaceIds],
	);

	function toggleWorkspace(workspaceId: string, checked: boolean) {
		setSelectedWorkspaceIds((current) =>
			checked
				? [...new Set([...current, workspaceId])]
				: current.filter((id) => id !== workspaceId),
		);
	}

	async function finishOAuthConsent(accept: boolean) {
		const result = await authClient.oauth2.consent({ accept });
		if (result.error) throw result.error;
		const data = result.data as { url?: string } | undefined;
		if (data?.url) window.location.assign(data.url);
	}

	async function approve() {
		if (
			!client ||
			selectedWorkspaceIds.length === 0 ||
			pendingAction !== null
		) {
			return;
		}
		setPendingAction("approve");
		setError("");
		try {
			await apiClient.endpoint(authorizeMcpConnection).call({
				body: {
					oauthQuery: searchParams.toString(),
					permissionProfile: profile,
					workspaceIds: selectedWorkspaceIds,
				},
			});
			await finishOAuthConsent(true);
		} catch (approvalError) {
			setError(
				authErrorMessage(
					approvalError,
					"Haunter could not approve this connection.",
				),
			);
			setPendingAction(null);
		}
	}

	async function deny() {
		if (pendingAction !== null) return;
		setPendingAction("deny");
		setError("");
		try {
			await finishOAuthConsent(false);
		} catch (denialError) {
			setError(
				authErrorMessage(
					denialError,
					"Haunter could not deny this connection.",
				),
			);
			setPendingAction(null);
		}
	}

	const clientName = client?.clientName?.trim() || "Unnamed MCP client";

	return (
		<Card className="w-full max-w-xl">
			<CardHeader className="border-b">
				<div className="mb-2 flex items-center gap-2">
					<GhostLogo className="size-8" />
					<span className="text-muted-foreground text-sm">Haunter</span>
				</div>
				<CardTitle className="text-xl">Connect an MCP client</CardTitle>
				<CardDescription>
					Choose what this AI client can do and which workspaces it can access.
					You can disconnect it at any time in Settings.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{clientError ? (
					<p role="alert" className="text-destructive text-sm">
						{clientError}
					</p>
				) : !client ? (
					<p className="rounded-lg border p-3 text-muted-foreground text-sm">
						Checking this authorization request…
					</p>
				) : (
					<>
						<div className="flex items-center gap-3 rounded-lg border p-3">
							<div className="grid size-10 place-items-center rounded-lg bg-muted">
								<BotIcon className="size-5 text-muted-foreground" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<p className="truncate font-medium">{clientName}</p>
									{client.identityVerified ? null : (
										<Badge variant="outline">Unverified identity</Badge>
									)}
								</div>
								{client.clientUri ? (
									<a
										href={client.clientUri}
										target="_blank"
										rel="noreferrer"
										className="inline-flex max-w-full items-center gap-1 truncate text-muted-foreground text-xs hover:text-foreground"
									>
										<span className="truncate">
											Client-provided website: {client.clientUri}
										</span>
										<ExternalLinkIcon className="size-3 shrink-0" />
									</a>
								) : (
									<p className="text-muted-foreground text-xs">
										No client website provided
									</p>
								)}
							</div>
						</div>
						{client.identityVerified ? null : (
							<div className="rounded-lg border bg-muted/40 p-3 text-sm">
								<p className="font-medium">
									Haunter has not verified this client
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Its name and website are self-reported. Only continue if you
									started this connection.
								</p>
							</div>
						)}
						<div className="rounded-lg border p-3">
							<p className="font-medium text-sm">Redirect destination</p>
							<p className="mt-1 break-all font-mono text-muted-foreground text-xs">
								{client.redirectUri}
							</p>
						</div>

						<fieldset className="flex flex-col gap-2">
							<legend className="mb-1 font-medium text-sm">Access</legend>
							{AGENT_PERMISSION_PROFILE_IDS.map((profileId) => {
								const definition = AGENT_PERMISSION_PROFILES[profileId];
								const selected = profile === profileId;
								return (
									<label
										key={profileId}
										className={cn(
											"relative flex w-full cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
											selected
												? "border-primary bg-primary/5"
												: "hover:bg-muted/50",
										)}
									>
										<input
											type="radio"
											name="mcp-permission-profile"
											value={profileId}
											checked={selected}
											className="sr-only"
											onChange={() => setProfile(profileId)}
										/>
										<span className="font-medium text-sm">
											{definition.label}
										</span>
										<span className="text-muted-foreground text-xs">
											{definition.description}
										</span>
									</label>
								);
							})}
						</fieldset>

						<fieldset className="flex flex-col gap-2">
							<legend className="mb-1 font-medium text-sm">Workspaces</legend>
							<p className="mb-1 text-muted-foreground text-xs">
								Current membership and roles are checked again for every action.
							</p>
							{workspacesQuery.isPending ? (
								<p className="rounded-lg border p-3 text-muted-foreground text-sm">
									Loading workspaces…
								</p>
							) : workspacesQuery.error ? (
								<p role="alert" className="text-destructive text-sm">
									Your workspaces could not be loaded.
								</p>
							) : (
								workspacesQuery.workspaces.map((workspace) => (
									<div
										key={workspace.id}
										className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
									>
										<Checkbox
											id={`mcp-workspace-${workspace.id}`}
											checked={selectedWorkspaceSet.has(workspace.id)}
											onCheckedChange={(checked) =>
												toggleWorkspace(workspace.id, checked === true)
											}
										/>
										<label
											htmlFor={`mcp-workspace-${workspace.id}`}
											className="min-w-0 flex-1 cursor-pointer truncate text-sm"
										>
											{workspace.logo ? `${workspace.logo} ` : ""}
											{workspace.name}
										</label>
									</div>
								))
							)}
						</fieldset>
					</>
				)}
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
			</CardContent>
			<CardFooter className="justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={pendingAction !== null || Boolean(clientError)}
					onClick={() => void deny()}
				>
					{pendingAction === "deny" ? "Denying…" : "Deny"}
				</Button>
				<Button
					type="button"
					disabled={
						!client ||
						selectedWorkspaceIds.length === 0 ||
						pendingAction !== null
					}
					onClick={() => void approve()}
				>
					{pendingAction === "approve" ? "Connecting…" : "Allow access"}
				</Button>
			</CardFooter>
		</Card>
	);
}
