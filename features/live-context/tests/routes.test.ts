import { expect, test } from "bun:test";
import { defineRoutes, createRateLimitHooks } from "@beignet/core/server";
import { createMemoryRateLimiter } from "@beignet/core/ports";
import { createTestPorts } from "@beignet/core/testing";
import { appPorts } from "@/infra/port-wiring";
import { createTestApp } from "@beignet/web/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { appContext } from "@/server/context";
import { documentFixture } from "@/features/documents/tests/helpers";
import { publishLiveContext } from "../contracts";
import { liveContextRoutes } from "../routes";
import { memoryContext } from "./helpers";

test("the HTTP reporter requires an authenticated matching user and never accepts another user's context", async () => {
	const f = await documentFixture("viewer");
	let authenticated = true;
	f.ctx.ports.liveContext = memoryContext();
	const fixture = createTestPorts<AppContext["ports"]>({
		base: appPorts,
		overrides: {
			...f.database.repositories,
			liveContext: f.ctx.ports.liveContext,
			gate: appPorts.gate,
			auth: { getSession: async () => (authenticated ? f.ctx.auth : null) },
			devtools: createInMemoryDevtools(),
			rateLimit: createMemoryRateLimiter(),
		},
	});
	const app = await createTestApp({
		ports: fixture.ports,
		routes: defineRoutes<AppContext>([liveContextRoutes]),
		context: appContext,
		hooks: [createRateLimitHooks<AppContext>()],
	});
	const body = {
		workspaceId: f.workspaceId,
		expectedUserId: f.userId,
		sessionId: crypto.randomUUID(),
		sequence: 1,
		contextAgeMs: 0,
		visible: true,
		focused: true,
		view: { pageId: f.page.id, canvas: null },
	};
	try {
		expect(await app.request(publishLiveContext, { body })).toEqual({
			accepted: true,
		});
		await expect(
			app.request(publishLiveContext, {
				body: { ...body, expectedUserId: "another-user" },
			}),
		).rejects.toMatchObject({ status: 403 });
		authenticated = false;
		await expect(
			app.request(publishLiveContext, { body }),
		).rejects.toMatchObject({ status: 401 });
		expect(await f.ctx.ports.liveContext.list(f.scope, f.userId)).toHaveLength(
			1,
		);
	} finally {
		await app.stop();
		f.database.close();
	}
});
