"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { SharedPage } from "@/features/shares/schemas";

const ReadOnlyEditor = dynamic(
	() => import("@/features/pages/components/editor/read-only-editor"),
	{ ssr: false, loading: () => <SharedPageSkeleton /> },
);

export function SharedPageSkeleton() {
	return (
		<div className="flex flex-col gap-3 px-0 md:px-[54px]" aria-hidden>
			<Skeleton className="h-4 w-11/12" />
			<Skeleton className="h-4 w-4/5" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="mt-5 h-4 w-3/4" />
			<Skeleton className="h-4 w-2/5" />
		</div>
	);
}

export function SharedPageReader({
	content,
	token,
}: {
	content: SharedPage["content"];
	token: string;
}) {
	return <ReadOnlyEditor content={content} shareToken={token} />;
}
