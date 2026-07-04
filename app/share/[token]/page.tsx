"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { use } from "react";
import { rq } from "@/client";
import { GhostLogo } from "@/components/ghost-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { getSharedPage } from "@/features/shares/contracts";

const ReadOnlyEditor = dynamic(
	() => import("@/features/pages/components/editor/read-only-editor"),
	{ ssr: false, loading: () => <SharedPageSkeleton /> },
);

function SharedPageSkeleton() {
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

export default function SharedPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = use(params);
	const pageQuery = useQuery(
		rq(getSharedPage).queryOptions({ path: { token } }),
	);

	return (
		<div className="min-h-dvh">
			<header className="flex h-12 items-center justify-between border-b px-4">
				<Link
					href="/"
					className="flex items-center gap-2 font-medium text-sm hover:opacity-80"
				>
					<GhostLogo className="size-5" />
					Haunter
				</Link>
				<span className="text-muted-foreground text-xs">Shared page</span>
			</header>
			<main className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
				{pageQuery.isPending ? (
					<>
						<div className="mb-6 px-0 md:px-[54px]">
							<Skeleton className="h-9 w-1/2 max-w-xs" />
						</div>
						<SharedPageSkeleton />
					</>
				) : pageQuery.isError || !pageQuery.data ? (
					<div className="flex flex-col items-center gap-2 py-24 text-center">
						<GhostLogo className="size-9 text-muted-foreground" />
						<p className="font-medium text-sm">
							This shared page is no longer available.
						</p>
						<p className="text-muted-foreground text-sm">
							The link may have been revoked, or the page moved to trash.
						</p>
					</div>
				) : (
					<>
						{pageQuery.data.icon ? (
							<p className="mb-1 px-0 text-4xl md:px-[54px]" aria-hidden>
								{pageQuery.data.icon}
							</p>
						) : null}
						<h1 className="mb-2 px-0 font-bold text-3xl md:px-[54px]">
							{pageQuery.data.title || "Untitled"}
						</h1>
						<ReadOnlyEditor content={pageQuery.data.content} />
					</>
				)}
			</main>
		</div>
	);
}
