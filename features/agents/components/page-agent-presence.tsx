"use client";

import { BotIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	type PageAgentActivity,
	pageAgentActivityLabel,
} from "@/features/agents/page-activity";
import { cn } from "@/lib/utils";

export function PageAgentPresence({
	agents,
}: {
	agents: readonly PageAgentActivity[];
}) {
	const first = agents[0];
	if (!first) return null;
	const active = agents.some((agent) => agent.phase === "active");
	const label =
		agents.length === 1
			? `${first.agentName} · ${pageAgentActivityLabel(first)}`
			: `${agents.length} agents on this page`;

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						aria-label={label}
						className={cn(
							"shrink-0 rounded-full px-2 text-xs pointer-coarse:min-h-11 pointer-coarse:min-w-11",
							active
								? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
								: "text-muted-foreground",
						)}
					/>
				}
			>
				<BotIcon className="size-4" aria-hidden="true" />
				<span className="hidden max-w-52 truncate lg:inline">{label}</span>
				{agents.length > 1 ? (
					<span className="lg:hidden">{agents.length}</span>
				) : null}
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-72 max-w-[calc(100vw-1.5rem)] gap-0 p-0"
			>
				<PopoverTitle className="sr-only">Agents on this page</PopoverTitle>
				<ul className="max-h-80 overflow-y-auto divide-y">
					{agents.map((agent) => (
						<li key={agent.agentId} className="space-y-3 p-4">
							<div>
								<div className="flex items-center gap-2">
									<span className="min-w-0 break-words font-medium">
										{agent.agentName}
									</span>
									<span className="shrink-0 rounded border px-1.5 text-muted-foreground text-xs">
										Agent
									</span>
								</div>
								<p className="mt-1 break-words text-muted-foreground text-xs">
									Connected by {agent.userName}
								</p>
							</div>
							<div className="flex items-start gap-2" aria-live="polite">
								<span
									aria-hidden="true"
									className={cn(
										"mt-1.5 size-1.5 shrink-0 rounded-full",
										agent.phase === "active"
											? "bg-primary"
											: "bg-muted-foreground",
									)}
								/>
								<div>
									<p>{pageAgentActivityLabel(agent)}</p>
									<p className="mt-0.5 text-muted-foreground text-xs">
										{agent.phase === "active"
											? "In progress"
											: "Recent activity"}
									</p>
								</div>
							</div>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
