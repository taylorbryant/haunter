"use client";

import { use } from "react";
import { TrashView } from "@/features/pages/components/trash-view";

export default function TrashPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);

	return <TrashView workspaceId={workspaceId} />;
}
