import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import { documentFixture } from "./helpers";

test("document access checks current membership, session expiry, deletion and scope", async () => {
	const f = await documentFixture();
	try {
		expect(await checkDocumentAccess(f.grant, f.database.db)).toBe("owner");
		await expect(
			checkDocumentAccess(
				{ ...f.grant, workspaceId: "another-workspace" },
				f.database.db,
			),
		).rejects.toThrow();
		await expect(
			checkDocumentAccess({ ...f.grant, expiresAt: 0 }, f.database.db),
		).rejects.toThrow();
		await f.database.db
			.update(schema.member)
			.set({ role: "viewer" })
			.where(eq(schema.member.id, "document-member"));
		expect(await checkDocumentAccess(f.grant, f.database.db)).toBe("viewer");
		await f.database.db
			.update(schema.session)
			.set({ expiresAt: new Date(0) })
			.where(eq(schema.session.id, "document-session"));
		await expect(checkDocumentAccess(f.grant, f.database.db)).rejects.toThrow();
		await f.database.db
			.update(schema.session)
			.set({ expiresAt: new Date(Date.now() + 600_000) })
			.where(eq(schema.session.id, "document-session"));
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(checkDocumentAccess(f.grant, f.database.db)).rejects.toThrow();
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			null,
		);
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.id, "document-member"));
		await expect(checkDocumentAccess(f.grant, f.database.db)).rejects.toThrow();
	} finally {
		await f.database.close();
	}
});
