import {
	type AgentPermissionProfile,
	capabilitiesForAgentPermissionProfile,
} from "../permission-profiles";

type FetchImplementation = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

type AgentAuthErrorPayload = {
	error?: string | { message?: string };
	message?: string;
};

async function agentAuthPost(
	path: string,
	body: Record<string, unknown>,
	fallbackMessage: string,
	fetchImplementation: FetchImplementation,
) {
	let response: Response;
	try {
		response = await fetchImplementation(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new Error(`${fallbackMessage} Check your connection and try again.`);
	}
	const payload = (await response
		.json()
		.catch(() => null)) as AgentAuthErrorPayload | null;
	const errorMessage =
		typeof payload?.error === "object"
			? payload.error.message
			: payload?.message;

	if (!response.ok || payload?.error) {
		throw new Error(errorMessage ?? fallbackMessage);
	}
}

export async function rememberAgentHostPermissionProfile({
	hostId,
	profile,
	fetchImplementation = fetch,
}: {
	hostId: string;
	profile: AgentPermissionProfile;
	fetchImplementation?: FetchImplementation;
}) {
	await agentAuthPost(
		"/api/auth/host/update",
		{
			host_id: hostId,
			default_capabilities: capabilitiesForAgentPermissionProfile(profile),
		},
		"Could not remember this client's access.",
		fetchImplementation,
	);
}

export async function disconnectAgentHost(
	hostId: string,
	fetchImplementation: FetchImplementation = fetch,
) {
	await agentAuthPost(
		"/api/auth/host/revoke",
		{ host_id: hostId },
		"Could not disconnect this client.",
		fetchImplementation,
	);
}
