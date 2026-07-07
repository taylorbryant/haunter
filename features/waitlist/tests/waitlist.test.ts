import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTestAnonymousActor } from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import type { AppContext } from "@/app-context";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { requestAccessUseCase } from "../use-cases";
import { createTestWaitlistRepository } from "./helpers";

function createTester(waitlist = createTestWaitlistRepository()) {
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			waitlist,
		},
		transaction: {
			ports: (ports) => ({ ...ports, waitlist }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestAnonymousActor(),
		auth: null,
	});

	return {
		waitlist,
		tester: createUseCaseTester<AppContext>(createTestContext),
	};
}

describe("waitlist", () => {
	it("waitlists an unknown email instead of creating an account", async () => {
		const { tester, waitlist } = createTester();

		const result = await tester.run(requestAccessUseCase, {
			email: "  NewUser@Example.com ",
		});

		expect(result).toEqual({ status: "waitlisted" });
		expect(waitlist.entries.has("newuser@example.com")).toBe(true);
	});

	it("lets an existing account continue to OTP sign-in", async () => {
		const { tester, waitlist } = createTester(
			createTestWaitlistRepository(["member@example.com"]),
		);

		const result = await tester.run(requestAccessUseCase, {
			email: "member@example.com",
		});

		expect(result).toEqual({ status: "existing" });
		expect(waitlist.entries.size).toBe(0);
	});

	it("updates the existing waitlist row when the same email asks again", async () => {
		const { tester, waitlist } = createTester();

		await tester.run(requestAccessUseCase, { email: "join@example.com" });
		await tester.run(requestAccessUseCase, { email: "join@example.com" });

		expect(waitlist.entries.size).toBe(1);
		expect(waitlist.entries.get("join@example.com")?.email).toBe(
			"join@example.com",
		);
	});
});

