import { afterEach, describe, expect, it } from "bun:test";
import { organization, user } from "@/infra/db/schema";
import type { TestDatabase } from "@/infra/db/test-database";
import { createTestDatabase } from "@/infra/db/test-database";

let database: TestDatabase | null = null;

afterEach(async () => {
	await database?.close();
	database = null;
});

describe("notification timezone preferences", () => {
	it("initializes once and only changes again through an intentional update", async () => {
		database = await createTestDatabase();
		const now = new Date();
		await database.db.insert(user).values({
			id: "user_timezone",
			name: "Timezone User",
			email: "timezone@example.com",
			createdAt: now,
			updatedAt: now,
		});

		const repository = database.repositories.notificationInbox;
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: true,
			taskAssignmentsEnabled: true,
			timezone: "UTC",
			timezoneConfigured: false,
		});

		await repository.initializeTimezone("user_timezone", "America/Chicago");
		await repository.initializeTimezone("user_timezone", "Europe/London");
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: true,
			taskAssignmentsEnabled: true,
			timezone: "America/Chicago",
			timezoneConfigured: true,
		});

		await repository.updatePreferences("user_timezone", {
			timezone: "Europe/London",
		});
		await repository.updatePreferences("user_timezone", {
			overdueTasksEnabled: false,
			taskAssignmentsEnabled: false,
		});
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: false,
			taskAssignmentsEnabled: false,
			timezone: "Europe/London",
			timezoneConfigured: true,
		});
	});
});

describe("task assignment notifications", () => {
	it("persists the assignment payload and deduplicates the same event", async () => {
		database = await createTestDatabase();
		const now = new Date();
		await database.db.insert(user).values({
			id: "user_assigned",
			name: "Assigned User",
			email: "assigned@example.com",
			createdAt: now,
			updatedAt: now,
		});
		await database.db.insert(organization).values({
			id: "workspace_test",
			name: "Test workspace",
			slug: `test-${crypto.randomUUID()}`,
			createdAt: now,
		});

		const repository = database.repositories.notificationInbox;
		const taskId = crypto.randomUUID();
		const candidate = {
			userId: "user_assigned",
			workspaceId: "workspace_test",
			entityVersion: "user_assigned:2026-07-25T12:00:00.000Z",
			taskId,
			title: "Review the launch plan",
			assignedByUserId: "user_manager",
			assignedByName: "Manager",
			pageId: null,
			sourceBlockId: null,
		};

		const created = await repository.createTaskAssigned(
			candidate,
			"2026-07-25T12:00:00.000Z",
		);
		const duplicate = await repository.createTaskAssigned(
			candidate,
			"2026-07-25T12:00:01.000Z",
		);

		expect(created).toMatchObject({
			kind: "task.assigned",
			entityId: taskId,
			payload: {
				title: "Review the launch plan",
				assignedByUserId: "user_manager",
				assignedByName: "Manager",
			},
		});
		expect(duplicate).toBeNull();
	});
});
