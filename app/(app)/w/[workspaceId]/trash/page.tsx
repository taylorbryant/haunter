"use client";

import { use } from "react";
import { TrashList } from "@/features/pages/components/trash-list";

export default function TrashPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading font-semibold text-xl">Trash</h1>
				<p className="text-muted-foreground text-sm">
					Deleted pages live here until you restore them or delete them forever.
				</p>
			</div>
			<TrashList workspaceId={workspaceId} />
		</div>
	);
}
