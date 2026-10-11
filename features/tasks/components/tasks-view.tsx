"use client";
import { PlusIcon } from "lucide-react";
import { useCreateDialog } from "@/components/create-dialog-provider";
import { Button } from "@/components/ui/button";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { TaskList } from "./task-list";

export function TasksView({
	workspaceId,
	className,
}: {
	workspaceId: string;
	className?: string;
}) {
	const canEdit = useCanEditWorkspace();
	const { openCreateTask } = useCreateDialog();
	return (
		<WorkspaceScreen className={className}>
			<WorkspaceScreenHeader
				title="Tasks"
				actions={
					canEdit ? (
						<Button type="button" onClick={openCreateTask}>
							<PlusIcon data-icon="inline-start" />
							Add task
						</Button>
					) : null
				}
			/>
			<TaskList workspaceId={workspaceId} />
		</WorkspaceScreen>
	);
}
