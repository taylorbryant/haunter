export const INVITATION_UNAVAILABLE_MESSAGE =
	"This invitation has expired or was already used.";

type InvitationClientError = {
	code?: string;
	message?: string;
};

type InvitationClientResponse = {
	data?: {
		invitation?: {
			organizationId?: string;
		};
	} | null;
	error?: InvitationClientError | null;
};

type OrganizationListResponse = {
	data?: ReadonlyArray<{ id: string }> | null;
	error?: InvitationClientError | null;
};

type AcceptWorkspaceInvitationDependencies = {
	acceptInvitation: (invitationId: string) => Promise<InvitationClientResponse>;
	listOrganizations: () => Promise<OrganizationListResponse>;
};

export type AcceptWorkspaceInvitationResult =
	| { ok: true; organizationId: string }
	| { ok: false; error: string };

export async function acceptWorkspaceInvitation(
	input: {
		invitationId: string;
		knownOrganizationId: string | null;
	},
	dependencies: AcceptWorkspaceInvitationDependencies,
): Promise<AcceptWorkspaceInvitationResult> {
	try {
		const { data, error } = await dependencies.acceptInvitation(
			input.invitationId,
		);

		if (!error) {
			const organizationId =
				input.knownOrganizationId ?? data?.invitation?.organizationId ?? null;
			if (!organizationId) {
				return {
					ok: false,
					error: "The invitation was accepted, but its workspace was missing.",
				};
			}
			return { ok: true, organizationId };
		}

		if (error.code === "INVITATION_NOT_FOUND" && input.knownOrganizationId) {
			const { data: organizations } = await dependencies.listOrganizations();
			if (
				organizations?.some(
					(organization) => organization.id === input.knownOrganizationId,
				)
			) {
				return { ok: true, organizationId: input.knownOrganizationId };
			}
			return { ok: false, error: INVITATION_UNAVAILABLE_MESSAGE };
		}

		return {
			ok: false,
			error: error.message ?? "Could not accept this invitation.",
		};
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Could not accept this invitation.",
		};
	}
}
