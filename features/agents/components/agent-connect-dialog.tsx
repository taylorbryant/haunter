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
	type AgentClientId,
	getAgentClientSetup,
	getAgentConnectionPrompt,
} from "@/features/agents/connect-config";
import { useWorkspaces } from "@/features/workspaces/client/use-workspaces";
import { cn } from "@/lib/utils";

type CopyTarget = "configuration" | "prompt";

export function AgentConnectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const workspacesQuery = useWorkspaces();
	const [clientId, setClientId] = useState<AgentClientId>("codex");
	const [workspaceId, setWorkspaceId] = useState("");
	const [copied, setCopied] = useState<CopyTarget | null>(null);
	const [copyError, setCopyError] = useState("");
	const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const setup = getAgentClientSetup(clientId);
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
			description="Choose your AI client, add Haunter as a local MCP server, then approve the access it requests."
			className="gap-5 sm:max-w-2xl"
		>
			<div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
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
					<h3 className="font-medium text-sm">2. Reload your client</h3>
					<p className="text-muted-foreground text-xs">
						{setup.restartInstruction}
					</p>
				</section>

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
								<SelectTrigger id="agent-connect-workspace" className="w-full">
									<SelectValue placeholder="Select a workspace" />
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false}>
									<SelectGroup>
										{workspaceItems.map((workspace) => (
											<SelectItem key={workspace.value} value={workspace.value}>
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
							aria-label={copied === "prompt" ? "Prompt copied" : "Copy prompt"}
						>
							{copied === "prompt" ? (
								<CheckIcon aria-hidden="true" />
							) : (
								<CopyIcon aria-hidden="true" />
							)}
						</Button>
					</div>
				</section>

				<p className="text-muted-foreground text-xs">
					Haunter currently connects through a local MCP bridge. Cloud-only
					clients such as ChatGPT are not supported yet.
				</p>
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
