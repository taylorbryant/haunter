import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return (
		<main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
			<div className="flex w-full max-w-sm flex-col gap-6">
				{children}
				<p className="text-center text-base text-muted-foreground sm:text-sm">
					<Link
						href="/guides"
						className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					>
						Explore the Haunter guides
					</Link>
				</p>
			</div>
		</main>
	);
}
