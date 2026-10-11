import type { Metadata } from "next";
import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import { SharedPageReader } from "@/features/shares/components/shared-page-reader";
import { createSharedPageMetadata } from "@/features/shares/lib/page-preview";
import { env } from "@/lib/env";
import { getSharedPageOrNotFound } from "./_data";

type SharedPageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({
	params,
}: SharedPageProps): Promise<Metadata> {
	const { token } = await params;
	const page = await getSharedPageOrNotFound(token);
	return createSharedPageMetadata(page, token, env.APP_URL);
}

export default async function SharedPage({ params }: SharedPageProps) {
	const { token } = await params;
	const page = await getSharedPageOrNotFound(token);

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
				{page.icon ? (
					<p className="mb-1 px-0 text-4xl md:px-[54px]" aria-hidden>
						{page.icon}
					</p>
				) : null}
				<h1 className="mb-2 px-0 font-bold text-3xl md:px-[54px]">
					{page.title || "Untitled"}
				</h1>
				<SharedPageReader content={page.content} token={token} />
			</main>
		</div>
	);
}
