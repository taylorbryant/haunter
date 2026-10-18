import Link from "next/link";
import { GhostLogo } from "@/components/ghost-logo";
import { buttonVariants } from "@/components/ui/button";

export default function AppNotFound() {
	return (
		<div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-24 text-center">
			<GhostLogo className="size-10 text-muted-foreground" />
			<div className="flex flex-col gap-1">
				<h1 className="font-heading font-semibold text-xl">Page not found</h1>
				<p className="text-muted-foreground text-sm">
					This page may have been deleted, moved, or shared with a different
					workspace.
				</p>
			</div>
			<Link href="/" className={buttonVariants({ variant: "secondary" })}>
				Go home
			</Link>
		</div>
	);
}
