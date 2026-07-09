import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";

export default function SharedPageNotFound() {
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
				<div className="flex flex-col items-center gap-2 py-24 text-center">
					<GhostLogo className="size-9 text-muted-foreground" />
					<p className="font-medium text-sm">
						This shared page is no longer available.
					</p>
					<p className="text-muted-foreground text-sm">
						The link may have been revoked, or the page moved to trash.
					</p>
				</div>
			</main>
		</div>
	);
}
