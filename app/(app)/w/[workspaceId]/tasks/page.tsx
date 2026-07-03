"use client";

import { use } from "react";
import { TaskList } from "@/features/tasks/components/task-list";

export default function TasksPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
			<h1 className="font-heading font-semibold text-xl">My Tasks</h1>
			<TaskList workspaceId={workspaceId} />
		</div>
	);
}
