import { Suspense } from "react";
import { McpConsentCard } from "@/features/agents/components/mcp-consent-card";

export default function OAuthConsentPage() {
	return (
		<main className="flex min-h-svh items-center justify-center bg-muted/40 p-4 sm:p-6">
			<Suspense
				fallback={
					<div className="h-96 w-full max-w-xl animate-pulse rounded-xl bg-muted" />
				}
			>
				<McpConsentCard />
			</Suspense>
		</main>
	);
}
