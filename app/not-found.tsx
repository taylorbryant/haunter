import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
	return (
		<main className="flex min-h-dvh items-center justify-center px-6 py-24 text-center">
			<div className="flex max-w-sm flex-col items-center gap-3">
				<GhostLogo className="size-10 text-muted-foreground" />
				<div className="flex flex-col gap-1">
					<h1 className="font-heading font-semibold text-xl">Page not found</h1>
					<p className="text-muted-foreground text-sm">
						This page does not exist, or the link is no longer valid.
					</p>
				</div>
				<Link href="/" className={buttonVariants({ variant: "secondary" })}>
					Go home
				</Link>
			</div>
		</main>
	);
}
