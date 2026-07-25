"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	AGENT_CLIENTS,
	AGENT_PACKAGE_RUNNERS,
	type AgentClientId,
	type AgentPackageRunnerId,
	getAgentClientSetup,
	getAgentConnectionPrompt,
	getHostedAgentClientSetup,
} from "@/features/agents/connect-config";
import { useWorkspaces } from "@/features/workspaces/client/use-workspaces";
import { cn } from "@/lib/utils";

type CopyTarget = "configuration" | "prompt";
type ConnectionMethod = "hosted" | "local";

export function AgentConnectDialog({
	open,
	onOpenChange,
	resourceUrl,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	resourceUrl: string;
}) {
	const workspacesQuery = useWorkspaces();
	const [clientId, setClientId] = useState<AgentClientId>("codex");
	const [connectionMethod, setConnectionMethod] =
		useState<ConnectionMethod>("hosted");
	const [runnerId, setRunnerId] = useState<AgentPackageRunnerId>("npx");
	const [workspaceId, setWorkspaceId] = useState("");
	const [copied, setCopied] = useState<CopyTarget | null>(null);
	const [copyError, setCopyError] = useState("");
	const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const setup =
		connectionMethod === "hosted"
			? getHostedAgentClientSetup(clientId, resourceUrl)
			: getAgentClientSetup(clientId, runnerId);
	const selectedWorkspace =
		workspacesQuery.workspaces.find(
			(workspace) => workspace.id === workspaceId,
		) ?? workspacesQuery.workspaces[0];
	const workspaceItems = workspacesQuery.workspaces.map((workspace) => ({
		label: `${workspace.logo ? `${workspace.logo} ` : ""}${workspace.name}`,
		value: workspace.id,
	}));
	const prompt = getAgentConnectionPrompt(selectedWorkspace);

	useEffect(
		() => () => {
			if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
		},
		[],
	);

	async function copyText(target: CopyTarget, text: string) {
		setCopyError("");
		try {
			await navigator.clipboard.writeText(text);
			setCopied(target);
			if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
			copyResetTimer.current = setTimeout(() => setCopied(null), 1500);
		} catch {
			setCopyError(
				"Could not copy to the clipboard. Select the text and copy it manually.",
			);
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Connect Haunter"
			description="Choose your AI client, add Haunter as an MCP server, then sign in and approve its access."
			className="gap-5 sm:max-w-2xl"
		>
			<div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
				{workspacesQuery.error ? (
					<div
						role="alert"
						className="flex items-center gap-2 text-destructive text-sm"
					>
						<span className="flex-1">Workspaces could not be loaded.</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void workspacesQuery.refetch?.()}
						>
							Try again
						</Button>
					</div>
				) : null}
				<fieldset className="min-w-0">
					<legend className="mb-2 font-medium text-sm">AI client</legend>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{AGENT_CLIENTS.map((client) => {
							const selected = client.id === clientId;
							return (
								<Button
									key={client.id}
									type="button"
									variant={selected ? "secondary" : "outline"}
									aria-pressed={selected}
									className="h-auto justify-start gap-2 p-2.5"
									onClick={() => setClientId(client.id)}
								>
									<span
										className={cn(
											"grid size-7 place-items-center rounded-md border bg-background font-semibold text-[10px]",
											selected && "border-foreground/15",
										)}
										aria-hidden="true"
									>
										{client.mark}
									</span>
									{client.label}
								</Button>
							);
						})}
					</div>
				</fieldset>

				<fieldset className="min-w-0">
					<legend className="mb-2 font-medium text-sm">
						Connection method
					</legend>
					<div className="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant={connectionMethod === "hosted" ? "secondary" : "outline"}
							aria-pressed={connectionMethod === "hosted"}
							className="h-auto flex-col items-start gap-1 p-3 text-left"
							onClick={() => setConnectionMethod("hosted")}
						>
							<span>Hosted</span>
							<span className="whitespace-normal font-normal text-muted-foreground text-xs">
								Recommended · no local bridge
							</span>
						</Button>
						<Button
							type="button"
							variant={connectionMethod === "local" ? "secondary" : "outline"}
							aria-pressed={connectionMethod === "local"}
							className="h-auto flex-col items-start gap-1 p-3 text-left"
							onClick={() => setConnectionMethod("local")}
						>
							<span>Local bridge</span>
							<span className="whitespace-normal font-normal text-muted-foreground text-xs">
								Agent Auth compatibility
							</span>
						</Button>
					</div>
				</fieldset>

				<section
					className="flex flex-col gap-2"
					aria-labelledby="agent-setup-step"
				>
					<div className="flex flex-col gap-1">
						<h3 id="agent-setup-step" className="font-medium text-sm">
							1. Add Haunter
						</h3>
						<p className="text-muted-foreground text-xs">
							{setup.installInstruction}
						</p>
					</div>
					<div className="flex flex-col gap-2">
						{connectionMethod === "local" ? (
							<fieldset className="flex flex-col gap-2">
								<legend className="font-medium text-xs">Package runner</legend>
								<div className="flex gap-2">
									{AGENT_PACKAGE_RUNNERS.map((runner) => (
										<Button
											key={runner.id}
											type="button"
											variant={runner.id === runnerId ? "secondary" : "outline"}
											size="sm"
											aria-pressed={runner.id === runnerId}
											onClick={() => setRunnerId(runner.id)}
										>
											{runner.label} ({runner.command})
										</Button>
									))}
								</div>
								<p className="text-muted-foreground text-xs">
									Choose the runner installed on the machine running your AI
									client.
								</p>
							</fieldset>
						) : null}
						<h4 className="font-medium text-xs">{setup.configurationLabel}</h4>
						<div className="relative">
							<pre className="max-h-52 overflow-auto whitespace-pre rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
								<code>{setup.configuration}</code>
							</pre>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								className="absolute top-2 right-2 bg-background/90"
								onClick={() => copyText("configuration", setup.configuration)}
								aria-label={
									copied === "configuration"
										? "Configuration copied"
										: "Copy configuration"
								}
							>
								{copied === "configuration" ? (
									<CheckIcon aria-hidden="true" />
								) : (
									<CopyIcon aria-hidden="true" />
								)}
							</Button>
						</div>
					</div>
				</section>

				<section className="flex flex-col gap-1">
					<h3 className="font-medium text-sm">
						2.{" "}
						{connectionMethod === "hosted" ? "Sign in" : "Reload your client"}
					</h3>
					<p className="text-muted-foreground text-xs">
						{setup.restartInstruction}
					</p>
				</section>

				{connectionMethod === "local" ? (
					<section
						className="flex flex-col gap-2"
						aria-labelledby="agent-connect-step"
					>
						<div className="flex flex-col gap-1">
							<h3 id="agent-connect-step" className="font-medium text-sm">
								3. Ask your agent to connect
							</h3>
							<p className="text-muted-foreground text-xs">
								Haunter will open an approval page before granting access.
							</p>
						</div>
						{workspacesQuery.workspaces.length > 0 ? (
							<div className="flex flex-col gap-2">
								<Label htmlFor="agent-connect-workspace">Workspace</Label>
								<Select
									items={workspaceItems}
									value={selectedWorkspace?.id ?? null}
									onValueChange={(value) => setWorkspaceId(value ?? "")}
								>
									<SelectTrigger
										id="agent-connect-workspace"
										className="w-full"
									>
										<SelectValue placeholder="Select a workspace" />
									</SelectTrigger>
									<SelectContent alignItemWithTrigger={false}>
										<SelectGroup>
											{workspaceItems.map((workspace) => (
												<SelectItem
													key={workspace.value}
													value={workspace.value}
												>
													{workspace.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</div>
						) : null}
						<div className="relative">
							<p className="rounded-lg border bg-muted/50 p-3 pr-12 text-sm leading-relaxed">
								{prompt}
							</p>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								className="absolute top-2 right-2 bg-background/90"
								onClick={() => copyText("prompt", prompt)}
								aria-label={
									copied === "prompt" ? "Prompt copied" : "Copy prompt"
								}
							>
								{copied === "prompt" ? (
									<CheckIcon aria-hidden="true" />
								) : (
									<CopyIcon aria-hidden="true" />
								)}
							</Button>
						</div>
					</section>
				) : (
					<p className="text-muted-foreground text-xs">
						Your client opens Haunter in the browser. Choose an access profile
						and one or more workspaces; no prompt is required.
					</p>
				)}

				{connectionMethod === "local" ? (
					<p className="text-muted-foreground text-xs">
						The local bridge remains available for clients that use the Agent
						Auth protocol directly.
					</p>
				) : null}
				{copyError ? (
					<p role="alert" className="text-destructive text-xs">
						{copyError}
					</p>
				) : null}
				<span className="sr-only" role="status">
					{copied === "configuration"
						? "Configuration copied."
						: copied === "prompt"
							? "Prompt copied."
							: ""}
				</span>
			</div>
			<ResponsiveDialogFooter>
				<Button
					type="button"
					variant="outline"
					onClick={() => onOpenChange(false)}
				>
					Done
				</Button>
			</ResponsiveDialogFooter>
		</ResponsiveDialog>
	);
}
