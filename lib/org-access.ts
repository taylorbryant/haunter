import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	memberAc,
	ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Access control for workspace (organization) roles. Isomorphic — imported by
 * both the Better Auth server instance and the browser auth client, which must
 * share the same `ac` and `roles`.
 *
 * Better Auth's access control only governs organization-management operations
 * (invite/remove members, edit/delete the org). Content-edit rights
 * (pages/tasks/canvases) are enforced by the app's own gate via
 * `canEditContent`, keyed on the role name — so `viewer` differs from `member`
 * only in the app's authorization, not in Better Auth's.
 */
export const accessControl = createAccessControl(defaultStatements);

/** Read-only workspace role: no organization-management permissions. */
export const viewer = accessControl.newRole({});

export const roles = {
	owner: ownerAc,
	admin: adminAc,
	member: memberAc,
	viewer,
};
