import { afterEach, describe, expect, it } from "bun:test";
import type { TestDatabase } from "@/infra/db/test-database";
import { createTestDatabase } from "@/infra/db/test-database";
import { user } from "@/infra/db/schema";

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
			timezone: "UTC",
			timezoneConfigured: false,
		});

		await repository.initializeTimezone("user_timezone", "America/Chicago");
		await repository.initializeTimezone("user_timezone", "Europe/London");
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: true,
			timezone: "America/Chicago",
			timezoneConfigured: true,
		});

		await repository.updatePreferences("user_timezone", {
			timezone: "Europe/London",
		});
		await repository.updatePreferences("user_timezone", {
			overdueTasksEnabled: false,
		});
		expect(await repository.getPreferences("user_timezone")).toEqual({
			overdueTasksEnabled: false,
			timezone: "Europe/London",
			timezoneConfigured: true,
		});
	});
});
