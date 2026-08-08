import { describe, expect, it } from "bun:test";
import { hasAppAccess } from "@/lib/auth";
import { ACCESS_STATUS_APPROVED, ACCESS_STATUS_WAITLISTED } from "@/ports/auth";

describe("app membership access", () => {
	function createContext(input: {
		accessStatus: string;
		activeRole?: string;
		workspaceIds?: string[];
	}) {
		let membershipListReads = 0;
		const ctx = {
			auth: {
				user: { id: "user_test", accessStatus: input.accessStatus },
				session: { activeOrganizationId: "workspace_removed" },
			},
			...(input.activeRole ? { membership: { role: input.activeRole } } : {}),
			ports: {
				members: {
					async findRole() {
						return input.activeRole ?? null;
					},
					async listForUser() {
						membershipListReads += 1;
						return (input.workspaceIds ?? []).map((id) => ({
							id,
							name: id,
							role: "member",
						}));
					},
					async listByWorkspace() {
						return [];
					},
				},
			},
		};

		return {
			ctx,
			membershipListReads: () => membershipListReads,
		};
	}

	it("does not trust a stale active organization without current membership", async () => {
		const { ctx, membershipListReads } = createContext({
			accessStatus: ACCESS_STATUS_WAITLISTED,
		});

		await expect(hasAppAccess(ctx)).resolves.toBeFalse();
		expect(membershipListReads()).toBe(1);
	});

	it("allows an accepted member with a stale active workspace", async () => {
		const { ctx, membershipListReads } = createContext({
			accessStatus: ACCESS_STATUS_WAITLISTED,
			workspaceIds: ["workspace_current"],
		});

		await expect(hasAppAccess(ctx)).resolves.toBeTrue();
		expect(membershipListReads()).toBe(1);
	});

	it("uses the verified active membership without listing workspaces", async () => {
		const { ctx, membershipListReads } = createContext({
			accessStatus: ACCESS_STATUS_WAITLISTED,
			activeRole: "member",
		});

		await expect(hasAppAccess(ctx)).resolves.toBeTrue();
		expect(membershipListReads()).toBe(0);
	});

	it("allows an app-approved user before they select a workspace", async () => {
		const { ctx, membershipListReads } = createContext({
			accessStatus: ACCESS_STATUS_APPROVED,
		});

		await expect(hasAppAccess(ctx)).resolves.toBeTrue();
		expect(membershipListReads()).toBe(0);
	});
});
