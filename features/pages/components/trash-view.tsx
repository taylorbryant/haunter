import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";
import { TrashList } from "./trash-list";

export function TrashView({
	workspaceId,
	allowPurge = true,
}: {
	workspaceId: string;
	allowPurge?: boolean;
}) {
	return (
		<WorkspaceScreen>
			<WorkspaceScreenHeader
				title="Trash"
				description={
					allowPurge
						? "Restore deleted pages or permanently remove them."
						: "Restore deleted pages to your workspace."
				}
			/>
			<TrashList workspaceId={workspaceId} allowPurge={allowPurge} />
		</WorkspaceScreen>
	);
}
