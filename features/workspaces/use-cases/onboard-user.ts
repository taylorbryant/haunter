import "@beignet/core/server-only";
import { reconcilePageTasks } from "@/features/tasks/lib/reconcile-page-tasks";
import { requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import { buildOnboardingPages } from "../lib/onboarding-content";
import { OnboardInputSchema, OnboardOutputSchema } from "../schemas";

/**
 * First-run onboarding: give a brand-new user a default workspace seeded with
 * example pages (whose task blocks reconcile into My Tasks) so they never land
 * on a zero state. Idempotent — a user who already has a workspace is returned
 * unchanged, so this is safe to call on every sign-in.
 */
export const onboardUserUseCase = useCase
	.command("workspaces.onboard")
	.input(OnboardInputSchema)
	.output(OnboardOutputSchema)
	.run(async ({ ctx }) => {
		const user = requireUser(ctx);
		await ctx.gate.authorize("workspaces.create");

		return ctx.ports.uow.transaction(async (tx) => {
			const [existing] = await tx.workspaces.listByUser(user.id);
			if (existing) {
				return { workspaceId: existing.id, pageId: null };
			}

			const workspace = await tx.workspaces.create({
				userId: user.id,
				name: "Personal",
				icon: "🏡",
				position: 1,
			});

			const today = new Date().toISOString().slice(0, 10);
			const pages = buildOnboardingPages(() => crypto.randomUUID(), today);

			let welcomePageId: string | null = null;
			let position = 1;
			for (const page of pages) {
				const created = await tx.pages.create({
					userId: user.id,
					workspaceId: workspace.id,
					parentPageId: null,
					title: page.title,
					position,
				});
				if (welcomePageId === null) welcomePageId = created.id;
				await tx.pages.update(created.id, { icon: page.icon });
				await tx.pages.saveContent(created.id, JSON.stringify(page.content));
				await reconcilePageTasks(tx.tasks, created, page.content);
				position += 1;
			}

			return { workspaceId: workspace.id, pageId: welcomePageId };
		});
	});
