import { describe, expect, it } from "bun:test";
import {
	acceptWorkspaceInvitation,
	INVITATION_UNAVAILABLE_MESSAGE,
} from "../client/accept-workspace-invitation";

describe("acceptWorkspaceInvitation", () => {
	it("returns the workspace from a successful acceptance", async () => {
		const result = await acceptWorkspaceInvitation(
			{ invitationId: "invite_1", knownOrganizationId: null },
			{
				acceptInvitation: async () => ({
					data: { invitation: { organizationId: "workspace_1" } },
				}),
				listOrganizations: async () => ({ data: [] }),
			},
		);

		expect(result).toEqual({ ok: true, organizationId: "workspace_1" });
	});

	it("recovers when the invitation was consumed but membership exists", async () => {
		let listCalls = 0;
		const result = await acceptWorkspaceInvitation(
			{
				invitationId: "invite_1",
				knownOrganizationId: "workspace_1",
			},
			{
				acceptInvitation: async () => ({
					error: {
						code: "INVITATION_NOT_FOUND",
						message: "Invitation not found",
					},
				}),
				listOrganizations: async () => {
					listCalls += 1;
					return { data: [{ id: "workspace_1" }] };
				},
			},
		);

		expect(result).toEqual({ ok: true, organizationId: "workspace_1" });
		expect(listCalls).toBe(1);
	});

	it("explains when a consumed invitation did not create membership", async () => {
		const result = await acceptWorkspaceInvitation(
			{
				invitationId: "invite_1",
				knownOrganizationId: "workspace_1",
			},
			{
				acceptInvitation: async () => ({
					error: {
						code: "INVITATION_NOT_FOUND",
						message: "Invitation not found",
					},
				}),
				listOrganizations: async () => ({ data: [] }),
			},
		);

		expect(result).toEqual({
			ok: false,
			error: INVITATION_UNAVAILABLE_MESSAGE,
		});
	});

	it("preserves actionable acceptance errors", async () => {
		let listCalls = 0;
		const result = await acceptWorkspaceInvitation(
			{
				invitationId: "invite_1",
				knownOrganizationId: "workspace_1",
			},
			{
				acceptInvitation: async () => ({
					error: {
						code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
						message: "This invitation belongs to a different email address.",
					},
				}),
				listOrganizations: async () => {
					listCalls += 1;
					return { data: [] };
				},
			},
		);

		expect(result).toEqual({
			ok: false,
			error: "This invitation belongs to a different email address.",
		});
		expect(listCalls).toBe(0);
	});
});
