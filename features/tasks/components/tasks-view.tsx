"use client";
import { cn } from "@/lib/utils";
import { TaskList } from "./task-list";

export function TasksView({
	workspaceId,
	className,
}: {
	workspaceId: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10",
				className,
			)}
		>
			<h1 className="font-heading font-semibold text-xl">Tasks</h1>
			<TaskList workspaceId={workspaceId} />
		</div>
	);
}
