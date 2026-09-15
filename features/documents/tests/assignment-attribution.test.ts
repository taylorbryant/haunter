import { expect, test } from "bun:test";
import * as Y from "yjs";
import { trackAssignmentChanges } from "@/infra/documents/assignment-attribution";
import {
	patchDocumentBlockProps,
	appendDocumentBlocks,
} from "@/infra/documents/mutations";
import { persistPageBody } from "@/infra/documents/persistence";
import { seedPageBody } from "@/infra/documents/codec";
import * as schema from "@/infra/db/schema";
import {
	documentFixture,
	firstText,
	paragraph,
	seedFixtureBody,
} from "./helpers";

const task = (id: string, assignee: string) => ({
	id,
	type: "task",
	props: { assignee },
	content: [{ type: "text", text: "Assigned task", styles: {} }],
	children: [],
});

test("assignment attribution survives unrelated typing and acknowledgements do not discard newer changes", () => {
	const doc = seedPageBody([paragraph("Text"), task("assigned", "one")]);
	const tracker = trackAssignmentChanges(doc, (origin) =>
		typeof origin === "string" ? origin : null,
	);
	try {
		doc.transact(
			() =>
				patchDocumentBlockProps(doc, {
					blockId: "assigned",
					blockType: "task",
					props: { assignee: "two" },
				}),
			"assigner",
		);
		doc.transact(
			() => firstText(doc).insert(0, "Another person types"),
			"typist",
		);
		const first = tracker.capture();
		expect(first.get("assigned")).toEqual({
			assignee: "two",
			userId: "assigner",
		});
		doc.transact(
			() =>
				patchDocumentBlockProps(doc, {
					blockId: "assigned",
					blockType: "task",
					props: { assignee: "three" },
				}),
			null,
		);
		tracker.acknowledge(first);
		expect(tracker.capture().get("assigned")).toEqual({
			assignee: "three",
			userId: null,
		});
		doc.transact(
			() => appendDocumentBlocks(doc, [task("new-task", "two")]),
			"creator",
		);
		expect(tracker.capture().get("new-task")).toEqual({
			assignee: "two",
			userId: "creator",
		});
	} finally {
		doc.destroy();
	}
});

test("collaborative assignments create durable notifications once, suppress known self-assignment, and do not blame the checkpoint owner", async () => {
	const f = await documentFixture();
	const doc = new Y.Doc();
	try {
		await f.database.db.insert(schema.user).values({
			id: "recipient",
			name: "Recipient",
			email: "recipient@example.com",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await f.database.db.insert(schema.member).values({
			id: "recipient-member",
			userId: "recipient",
			organizationId: f.workspaceId,
			role: "member",
			createdAt: new Date(),
		});
		await seedFixtureBody(f, [paragraph("Body")]);
		const stored = await f.database.repositories.documents.find(
			f.scope,
			f.page.id,
		);
		Y.applyUpdate(doc, stored!.state);
		appendDocumentBlocks(doc, [
			task("other", "recipient"),
			task("self", f.userId),
		]);
		const result = await persistPageBody(f.ctx, {
			...f.grant,
			doc,
			baseRevision: 0,
			assignmentChanges: new Map([
				["other", { assignee: "recipient", userId: f.userId }],
				["self", { assignee: f.userId, userId: f.userId }],
			]),
		});
		expect(result.assignmentNotifications).toHaveLength(1);
		expect(result.assignmentNotifications[0]).toMatchObject({
			userId: "recipient",
			payload: { assignedByUserId: f.userId, assignedByName: "Document User" },
		});
		const repeated = await persistPageBody(f.ctx, {
			...f.grant,
			doc,
			baseRevision: 1,
		});
		expect(repeated.assignmentNotifications).toHaveLength(0);
		const versions = await f.database.db.select().from(schema.pageVersions);
		expect(versions[0]?.createdBy).toBeNull();
		appendDocumentBlocks(doc, [task("offline", "recipient")]);
		const offline = await persistPageBody(f.ctx, {
			...f.grant,
			doc,
			baseRevision: 2,
		});
		expect(offline.assignmentNotifications).toHaveLength(0);
		expect(await f.database.db.select().from(schema.notifications)).toHaveLength(
			1,
		);
	} finally {
		doc.destroy();
		await f.database.close();
	}
});

test("offline task creation and self-assignment persist without notifying the creator", async () => {
	const f = await documentFixture();
	const doc = new Y.Doc();
	try {
		await seedFixtureBody(f, [task("existing", "")], true);
		const stored = await f.database.repositories.documents.find(
			f.scope,
			f.page.id,
		);
		Y.applyUpdate(doc, stored!.state);
		const tracker = trackAssignmentChanges(doc, () => null);
		appendDocumentBlocks(doc, [task("offline-self", f.userId)]);
		patchDocumentBlockProps(doc, {
			blockId: "existing",
			blockType: "task",
			props: { assignee: f.userId },
		});
		const result = await persistPageBody(f.ctx, {
			...f.grant,
			doc,
			baseRevision: stored!.revision,
			assignmentChanges: tracker.capture(),
		});
		const tasks = await f.database.repositories.tasks.listByPage(
			f.scope,
			f.page.id,
		);
		expect(tasks).toHaveLength(2);
		expect(tasks.every((task) => task.assigneeId === f.userId)).toBe(true);
		expect(result.assignmentNotifications).toHaveLength(0);
		expect(await f.database.db.select().from(schema.notifications)).toHaveLength(
			0,
		);
	} finally {
		doc.destroy();
		await f.database.close();
	}
});
