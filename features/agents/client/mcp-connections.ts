import { apiClient } from "@/client";
import { disconnectMcpConnection } from "@/features/agents/contracts";

export async function disconnectRemoteMcpConnection(connectionId: string) {
	await apiClient.endpoint(disconnectMcpConnection).call({
		path: { connectionId },
	});
}
