import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return (
		<main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
			<div className="w-full max-w-sm">{children}</div>
		</main>
	);
}
