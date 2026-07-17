"use client";

import { useEffect } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";

export default function RootError({
	error,
	unstable_retry,
}: {
	error: Error & { digest?: string };
	unstable_retry: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-24 text-center">
			<GhostLogo className="size-10 text-muted-foreground" />
			<div className="flex flex-col gap-1">
				<h1 className="font-heading font-semibold text-xl">
					Something went wrong
				</h1>
				<p className="text-muted-foreground text-sm">
					Haunter could not load this page. Try again, or reload the page.
				</p>
			</div>
			<Button type="button" variant="secondary" onClick={unstable_retry}>
				Try again
			</Button>
		</main>
	);
}
