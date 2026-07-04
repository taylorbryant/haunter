import { ApproveAgentCard } from "@/features/agents/components/approve-agent-card";

/**
 * Agent Auth Protocol device-authorization page. Agents send their user here
 * via `verification_uri_complete` (`?agent_id=…&code=…`) after registering;
 * the signed-in user reviews the requested capabilities and approves or
 * denies with the user code.
 */
export default async function DeviceCapabilitiesPage({
	searchParams,
}: {
	searchParams: Promise<{ agent_id?: string; code?: string }>;
}) {
	const params = await searchParams;
	const agentId = params.agent_id ?? "";
	const code = params.code ?? "";

	return (
		<div className="flex flex-1 items-start justify-center p-6 md:pt-16">
			{agentId ? (
				<ApproveAgentCard agentId={agentId} initialCode={code} />
			) : (
				<div className="flex max-w-md flex-col gap-2 text-center">
					<h1 className="font-semibold text-lg">Approve an agent</h1>
					<p className="text-muted-foreground text-sm">
						Open the approval link your agent gave you — it contains the request
						id and confirmation code this page needs.
					</p>
				</div>
			)}
		</div>
	);
}
