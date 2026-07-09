import { isAppError } from "@beignet/core/errors";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GhostLogo } from "@/components/ghost-logo";
import { SharedPageReader } from "@/features/shares/components/shared-page-reader";
import type { SharedPage as SharedPageData } from "@/features/shares/schemas";
import { getSharedPageUseCase } from "@/features/shares/use-cases";
import { getAppRequestContext } from "@/lib/server-react-query";

async function getSharedPageOrNotFound(token: string): Promise<SharedPageData> {
	const ctx = await getAppRequestContext();

	try {
		return await getSharedPageUseCase.run({ ctx, input: { token } });
	} catch (error) {
		if (isAppError(error) && error.code === "SHARE_NOT_FOUND") {
			notFound();
		}
		throw error;
	}
}

export default async function SharedPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
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
