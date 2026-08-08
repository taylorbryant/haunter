# Workspace membership authorization

Haunter uses Better Auth organizations as workspaces. Better Auth owns the
organization, member, invitation, and active-organization session writes;
Haunter reads those tables through `MemberRepository` when it authorizes app
and agent operations.

## Trust boundary

`activeOrganizationId`, route parameters, MCP grants, and capability arguments
identify a requested workspace. None of them prove current membership.

For an HTTP request, `server/context.ts`:

1. authenticates the session;
2. treats the session's active organization as a candidate tenant;
3. reads the user's current role from the Better Auth `member` table; and
4. exposes `ctx.tenant` and `ctx.membership` only when that row exists.

Repository scope is created from this verified context. A stale active
organization therefore cannot authorize reads after a user is removed. App-wide
approved users may still enter Haunter without a workspace, but they cannot
receive workspace scope until they are a current member. For an unapproved user
whose active organization is stale, the app-entry layout may check
`listForUser` so the root route can select another current workspace; this
grants entry to the shell, not tenant scope for the stale organization.

Pending invitations live in Better Auth's separate `invitation` table. They do
not appear in `findRole`, `listForUser`, or the workspace roster and grant no
workspace access. Accepting an invitation creates the member row that makes the
workspace visible and authoritative.

## Agent requests

Agent grants describe which capabilities and workspace IDs a client may ask to
use. They do not replace membership. Before each workspace-scoped capability,
`server/agent-capabilities.ts` reads the acting user's current role through
`MemberRepository.findRole`. It rejects a missing row and supplies the current
role to the service context, so removal and role changes take effect on the next
agent call.

`createServiceContext({ asUser, tenantId })` is intentionally a trusted
primitive for non-HTTP entrypoints. Callers must verify membership before using
it. New agent or background entrypoints should share the same lookup pattern
rather than accepting a role from a token, request body, or cached client state.

## UI and provider responsibilities

The browser may use Better Auth's organization client for invitations,
membership administration, and active-workspace selection. Server contracts
remain the enforcement boundary and always authorize against current database
state. Client-side workspace state is navigation state, not access control.

`MemberRepository.findRole` is memoized within a request to avoid duplicate
Turso reads. Membership writes are performed by Better Auth endpoints, not
inside Haunter content requests, so no same-request invalidation is required.
The following request or agent execution observes a role change or revocation.

## Regression coverage

- `features/pages/tests/routes.test.ts` covers stale active organizations,
  accepted waitlisted members, and requests without current membership.
- `features/members/tests/access-policy.test.ts` and
  `membership-authority.test.ts` prove that stale active organizations and
  pending invitations grant no access, while acceptance and revocation follow
  the member row.
- `features/agents/tests/capabilities.test.ts` proves membership is re-read for
  every agent execution, current roles reach service context, and workspace
  constraints cannot cross an authorized tenant.

When adding a new workspace-scoped route or capability, keep its workspace ID
required in the contract, derive repository scope from verified context, and
add a denial test for a known resource in another workspace.
