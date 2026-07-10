import "@beignet/core/server-only";
import { reconcilePageDerivations } from "@/features/pages/lib/apply-page-content";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { canEditContent } from "@/lib/org-access";
import { useCase } from "@/lib/use-case";
import { buildOnboardingPages } from "../lib/onboarding-content";
import { OnboardInputSchema, OnboardOutputSchema } from "../schemas";

/**
 * First-run onboarding: seed the just-created workspace (a Better Auth
 * organization the client creates and sets active at sign-up) with example
 * pages whose task blocks reconcile into My Tasks, so a new member never lands
 * on a zero state. Idempotent — a workspace that already has pages is returned
 * unchanged, so this is safe to call on every sign-in.
 */
export const onboardUserUseCase = useCase
	.command("workspaces.onboard")
	.input(OnboardInputSchema)
	.output(OnboardOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		const scope = requireActiveWorkspaceScope(ctx);
		const workspaceId = scope.id;

		// Seeding writes pages, so read-only members never seed — a viewer
		// signing into a not-yet-seeded shared workspace is a no-op, not an
		// error (this runs on every sign-in).
		if (!canEditContent(ctx.membership?.role)) {
			return { workspaceId, pageId: null };
		}

		return ctx.ports.uow.transaction(async (tx) => {
			// "Already onboarded" must count trashed pages too: a user who
			// trashes everything shouldn't get the welcome content re-seeded on
			// their next sign-in.
			const [live, trashed] = await Promise.all([
				tx.pages.listMetaByWorkspace(scope),
				tx.pages.listTrashedMetaByWorkspace(scope),
			]);
			if (live.length > 0 || trashed.length > 0) {
				return { workspaceId, pageId: null };
			}

			const today = new Date().toISOString().slice(0, 10);
			const pages = buildOnboardingPages(() => crypto.randomUUID(), today);

			let welcomePageId: string | null = null;
			let position = 1;
			for (const page of pages) {
				const created = await tx.pages.create(scope, {
					userId: user.id,
					parentPageId: null,
					title: page.title,
					position,
				});
				if (welcomePageId === null) welcomePageId = created.id;
				await tx.pages.update(scope, created.id, { icon: page.icon });
				await tx.pages.saveContent(
					scope,
					created.id,
					JSON.stringify(page.content),
					extractPageSearchText(page.content),
				);
				await reconcilePageDerivations(tx, scope, created, page.content, {
					defaultTaskAssigneeId: user.id,
				});
				position += 1;
			}

			return { workspaceId, pageId: welcomePageId };
		});
	});
