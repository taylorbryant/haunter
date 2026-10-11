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
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:gap-6 sm:px-6 sm:py-10">
			<div className="flex flex-col gap-2">
				<h1 className="font-heading font-semibold text-xl">Trash</h1>
				<p className="text-base text-muted-foreground leading-6 sm:text-sm">
					Restore deleted pages or permanently remove them.
				</p>
			</div>
			<TrashList workspaceId={workspaceId} />
		</div>
	);
}
