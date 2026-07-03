"use client";

import { use } from "react";
import { PageEditor } from "@/features/pages/components/page-editor";

export default function PagePage({
	params,
}: {
	params: Promise<{ pageId: string }>;
}) {
	const { pageId } = use(params);
	return <PageEditor pageId={pageId} />;
}
