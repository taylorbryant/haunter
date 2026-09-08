import * as Y from "yjs";
import { PAGE_BODY_FRAGMENT } from "../model";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestUserActor,
} from "@beignet/core/testing";
import {
	createDrizzleSqliteUnitOfWork,
	createDrizzleSqliteIdempotencyPort,
} from "@beignet/provider-db-drizzle/sqlite";
import type { AppContext } from "@/app-context";
import { createRepositories } from "@/infra/db/repositories";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";

export async function documentFixture(role = "owner") {
	const database = await createTestDatabase();
	const userId = "document-user",
		workspaceId = "document-workspace";
	const now = new Date();
	await database.db.insert(schema.user).values({
		id: userId,
		name: "Document User",
		email: "document@example.com",
		emailVerified: true,
		accessStatus: "approved",
		createdAt: now,
		updatedAt: now,
	});
	await database.db.insert(schema.organization).values({
		id: workspaceId,
		name: "Documents",
		slug: "documents",
		createdAt: now,
	});
	await database.db.insert(schema.member).values({
		id: "document-member",
		organizationId: workspaceId,
		userId,
		role,
		createdAt: now,
	});
	await database.db.insert(schema.session).values({
		id: "document-session",
		token: "test-only-token",
		userId,
		activeOrganizationId: workspaceId,
		expiresAt: new Date(Date.now() + 600_000),
		createdAt: now,
		updatedAt: now,
	});
	const scope = createTenantScope({ id: workspaceId });
	const page = await database.repositories.pages.create(scope, {
		userId,
		title: "Document",
		parentPageId: null,
		position: 0,
	});
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			...database.repositories,
			gate: appPorts.gate,
			taskAssignmentDelivery: { schedule() {} },
			bestEffortWork: { defer() {} },
			uow: createDrizzleSqliteUnitOfWork({
				db: database.db,
				createTransactionPorts: (tx) => ({
					...createRepositories(tx),
					idempotency: createDrizzleSqliteIdempotencyPort(tx),
				}),
			}),
		},
	});
	const ctx = createTestContextFactory<AppContext, AppContext["ports"]>({
		ports: fixture.ports,
		actor: createTestUserActor(userId),
		tenant: { id: workspaceId },
		auth: {
			user: { id: userId, accessStatus: "approved" },
			session: { id: "document-session", activeOrganizationId: workspaceId },
		},
		extra: { membership: { role } },
	})();
	return {
		database,
		ctx,
		scope,
		page,
		userId,
		workspaceId,
		grant: {
			generation: 0,
			userId,
			workspaceId,
			pageId: page.id,
			sessionId: "document-session",
			expiresAt: Date.now() + 300_000,
		},
	};
}

export function firstText(doc: Y.Doc): Y.XmlText {
	const fragment = doc.getXmlFragment(PAGE_BODY_FRAGMENT);
	for (const child of fragment.createTreeWalker(() => true))
		if (child instanceof Y.XmlText) return child;
	const group = fragment.get(0) as Y.XmlElement;
	const container = group.get(0) as Y.XmlElement;
	const paragraph = container.get(0) as Y.XmlElement;
	const text = new Y.XmlText();
	paragraph.insert(0, [text]);
	return text;
}

export const paragraph = (text: string, id = crypto.randomUUID()) => ({
	id,
	type: "paragraph",
	props: {},
	content: [{ type: "text", text, styles: {} }],
	children: [],
});

/** Arrange an existing fixture before any clients connect; not an application writer. */
export async function seedFixtureBody(
	f: Awaited<ReturnType<typeof documentFixture>>,
	content: import("@/features/content/schemas").BlockJson[],
	reconcile = false,
) {
	const { seedPageBody, projectPageBody } = await import(
		"@/infra/documents/codec"
	);
	const { eq } = await import("drizzle-orm");
	const { extractPageSearchText } = await import(
		"@/features/pages/lib/extract-page-text"
	);
	const doc = seedPageBody(content);
	try {
		const projected = projectPageBody(doc);
		await f.database.db.transaction(async (tx) => {
			await tx
				.update(schema.pages)
				.set({
					content: JSON.stringify(projected),
					searchText: extractPageSearchText(projected),
				})
				.where(eq(schema.pages.id, f.page.id));
			await tx
				.update(schema.collaborativeDocuments)
				.set({
					state: Buffer.from(Y.encodeStateAsUpdate(doc)),
					revision: 0,
					generation: 0,
				})
				.where(eq(schema.collaborativeDocuments.pageId, f.page.id));
			if (reconcile) {
				const { reconcilePageDerivations } = await import(
					"@/features/pages/lib/apply-page-content"
				);
				await reconcilePageDerivations(
					createRepositories(tx),
					f.scope,
					f.page,
					projected,
					{ defaultTaskAssigneeId: f.userId },
				);
			}
		});
	} finally {
		doc.destroy();
	}
}
