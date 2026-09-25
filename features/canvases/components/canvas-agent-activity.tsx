"use client";
import { BotIcon, CheckIcon, CircleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { useEditor } from "tldraw";
import {
	canvasAgentActivityLabel,
	type CanvasAgentActivity as CanvasActivityEvent,
} from "@/features/agents/canvas-activity";
import { useCanvasAgents } from "@/features/agents/client/use-canvas-agents";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { setAgentHighlights } from "../client/agent-highlights";

export function CanvasAgentPresence({
	agents,
}: {
	agents: readonly CanvasActivityEvent[];
}) {
	return (
		<div
			className="pointer-events-none absolute inset-x-2 top-14 z-300 flex flex-col items-start gap-1"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{agents.slice(0, 3).map((agent) => {
				const Icon =
					agent.phase === "active"
						? BotIcon
						: agent.phase === "failed"
							? CircleAlertIcon
							: CheckIcon;
				return (
					<div
						key={agent.agentId}
						className="flex max-w-full items-center gap-2 rounded-md border border-border/60 bg-background/95 py-1 pr-3 pl-1.5 text-base sm:text-sm"
					>
						<Icon
							className={
								agent.phase === "failed"
									? "size-4 shrink-0 text-destructive"
									: "size-4 shrink-0 text-primary"
							}
							aria-hidden="true"
						/>
						<div className="min-w-0">
							<div className="truncate font-medium">
								{agent.agentName}
								<span className="font-normal text-muted-foreground">
									{" "}
									· {agent.userName}
								</span>
							</div>
							<div className="text-muted-foreground">
								{canvasAgentActivityLabel(agent)}
							</div>
						</div>
					</div>
				);
			})}
			{agents.length > 3 ? (
				<div className="rounded-md bg-background/95 px-2 py-1 text-base sm:text-sm">
					{agents.length - 3} more agents
				</div>
			) : null}
		</div>
	);
}

export function CanvasAgentActivity({
	userId,
	workspaceId,
	canvasId,
}: {
	userId: string;
	workspaceId: string;
	canvasId: string;
}) {
	const editor = useEditor();
	const enabled = useProtectedRequestsEnabled();
	const { agents, shapeIds } = useCanvasAgents(userId, workspaceId, canvasId);
	useEffect(() => {
		setAgentHighlights(editor, enabled ? shapeIds : []);
		return () => setAgentHighlights(editor, []);
	}, [editor, enabled, shapeIds]);
	return <CanvasAgentPresence agents={enabled ? agents : []} />;
}
