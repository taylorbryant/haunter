import { expect, test } from "bun:test";
import { createTenantScope } from "@beignet/core/ports";
import { documentFixture } from "@/features/documents/tests/helpers";
import { createTestMcpConnectionRepository } from "@/features/agents/tests/helpers";
import { executeRemoteMcpCapability } from "@/server/agent-capabilities";
import {
	memoryContext,
	textEditingFixture,
	pageSelectionFixture,
} from "./helpers";
import {
	publishLiveContextUseCase,
	listActiveSessionsUseCase,
	getActiveContextUseCase,
} from "../use-cases";
import {
	type PublishContextInput,
	GetActiveContextOutputSchema,
	ListActiveSessionsOutputSchema,
	PublishContextInputSchema,
} from "../schemas";
import { createRedisLiveContext } from "@/infra/live-context/redis-live-context";

async function fixture() {
	const f = await documentFixture("viewer");
	f.ctx.ports.liveContext = memoryContext();
	f.ctx.ports.workspaceEventStreamLeases = {
		isConfigured: () => false,
		acquire: async () => null,
	};
	const input: PublishContextInput = {
		workspaceId: f.workspaceId,
		expectedUserId: f.userId,
		sessionId: crypto.randomUUID(),
		sequence: 1,
		reportedAt: Date.now(),
		contextAgeMs: 1000,
		visible: true,
		focused: true,
		view: { pageId: f.page.id, canvas: null },
	};
	const publish = (patch: Partial<PublishContextInput> = {}) =>
		publishLiveContextUseCase.run({
			ctx: f.ctx,
			input: { ...input, ...patch },
		});
	const list = () =>
		listActiveSessionsUseCase.run({
			ctx: f.ctx,
			input: { workspaceId: f.workspaceId },
		});
	const get = (sessionId = input.sessionId) =>
		getActiveContextUseCase.run({
			ctx: f.ctx,
			input: { workspaceId: f.workspaceId, sessionId },
		});
	return { ...f, input, publish, list, get };
}

test("a viewer can publish their page and canvas context without changing document history", async () => {
	const f = await fixture();
	try {
		const canvas = await f.ctx.ports.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: null,
		});
		const view = {
			pageId: f.page.id,
			canvas: {
				canvasId: canvas.id,
				canvasPageId: "page:one",
				selectedShapeIds: ["shape:a"],
				selectionCount: 1,
				textEditing: textEditingFixture,
			},
		};
		await f.publish({ view });
		const { context } = await f.get();
		expect(context).toMatchObject({
			view,
			pageTitle: "Document",
			stale: false,
			selectionComplete: true,
		});
		expect(context.lastSeenAt - context.capturedAt).toBe(1000);
		expect((await f.list()).sessions).toHaveLength(1);
		expect(
			await f.ctx.ports.canvases.listHistory(f.scope, canvas.id),
		).toHaveLength(0);
	} finally {
		f.database.close();
	}
});

test("sessions belong only to their publisher and current authorized workspace", async () => {
	const f = await fixture();
	try {
		await f.ctx.ports.liveContext.publish(f.scope, "another-user", f.input);
		await f.ctx.ports.liveContext.publish(
			createTenantScope({ id: "other-workspace" }),
			f.userId,
			{ ...f.input, workspaceId: "other-workspace" },
		);
		expect((await f.list()).sessions).toEqual([]);
		await expect(f.get()).rejects.toMatchObject({
			code: "ACTIVE_SESSION_NOT_FOUND",
		});
		await expect(
			f.publish({ expectedUserId: "another-user" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			f.publish({ workspaceId: "other-workspace" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	} finally {
		f.database.close();
	}
});

test("archived pages and removed canvases are not exposed from cached context", async () => {
	const f = await fixture();
	try {
		await f.publish();
		await f.ctx.ports.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		expect((await f.list()).sessions).toEqual([]);
		await expect(f.get()).rejects.toMatchObject({
			code: "ACTIVE_SESSION_NOT_FOUND",
		});
	} finally {
		f.database.close();
	}
});

test("rejects a canvas paired with the wrong parent and supports standalone canvas context", async () => {
	const f = await fixture();
	try {
		const canvas = await f.ctx.ports.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "Standalone",
		});
		const selection = {
			canvasId: canvas.id,
			canvasPageId: "page:one",
			selectedShapeIds: [],
			selectionCount: 0,
		};
		await expect(
			f.publish({ view: { pageId: f.page.id, canvas: selection } }),
		).rejects.toMatchObject({ code: "ACTIVE_SESSION_NOT_FOUND" });
		await f.publish({ view: { pageId: null, canvas: selection } });
		expect((await f.get()).context.canvasTitle).toBe("Standalone");
		await f.ctx.ports.canvases.delete(f.scope, canvas.id);
		await expect(f.get()).rejects.toMatchObject({
			code: "ACTIVE_SESSION_NOT_FOUND",
		});
	} finally {
		f.database.close();
	}
});

test("stale, expired, withdrawn and truncated context are explicit", async () => {
	const f = await fixture();
	try {
		let clock = Date.now() - 60_000;
		f.ctx.ports.liveContext = memoryContext(() => clock);
		await f.publish();
		expect((await f.get()).context.stale).toBe(true);
		clock = Date.now() - 121_000;
		await f.publish({ sequence: 2 });
		expect((await f.list()).sessions).toEqual([]);
		clock = Date.now();
		await f.publish({ sequence: 3 });
		await f.publish({ sequence: 4, view: null });
		await f.publish({ sequence: 3 });
		expect((await f.list()).sessions).toEqual([]);
		const canvas = await f.ctx.ports.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: null,
		});
		await f.publish({
			sequence: 5,
			view: {
				pageId: f.page.id,
				canvas: {
					canvasId: canvas.id,
					canvasPageId: "page:one",
					selectedShapeIds: ["shape:a"],
					selectionCount: 101,
				},
			},
		});
		expect((await f.get()).context.selectionComplete).toBe(false);
	} finally {
		f.database.close();
	}
});

test("unconfigured context reports unavailable instead of pretending there are no sessions", async () => {
	const f = await fixture();
	try {
		f.ctx.ports.liveContext = createRedisLiveContext({
			redis: null,
			prefix: "test",
		});
		await expect(f.list()).rejects.toMatchObject({
			code: "LIVE_CONTEXT_UNAVAILABLE",
		});
	} finally {
		f.database.close();
	}
});

test("View-only MCP discovers its own sessions and rejects workspace escalation and revoked membership", async () => {
	const f = await fixture();
	try {
		const connection = {
			id: "context-mcp",
			userId: f.userId,
			clientId: "client",
			clientName: "Test",
			permissionProfile: "view" as const,
			status: "active" as const,
			workspaceIds: [f.workspaceId],
			lastUsedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		f.ctx.ports.mcpConnections = createTestMcpConnectionRepository(
			[connection],
			[],
		);
		const server = {
			ports: f.ctx.ports,
			createServiceContext: async () => f.ctx,
		};
		const execute = (capability: string, args: Record<string, unknown>) =>
			executeRemoteMcpCapability(
				{
					capability,
					arguments: { workspaceId: f.workspaceId, ...args },
					userId: f.userId,
					clientId: "client",
				},
				{ getServer: async () => server },
			);
		const canvas = await f.ctx.ports.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: null,
		});
		await f.publish({
			view: {
				pageId: f.page.id,
				canvas: {
					canvasId: canvas.id,
					canvasPageId: "page:one",
					selectedShapeIds: ["shape:a"],
					selectionCount: 1,
					textEditing: textEditingFixture,
				},
			},
		});
		const list = ListActiveSessionsOutputSchema.parse(
			await execute("list_active_sessions", {}),
		);
		expect(list.sessions[0].sessionId).toBe(f.input.sessionId);
		expect(list.sessions[0]).not.toHaveProperty("view");
		expect(JSON.stringify(list)).not.toContain("Hello");
		expect(
			GetActiveContextOutputSchema.parse(
				await execute("get_active_context", { sessionId: f.input.sessionId }),
			).context.view.pageId,
		).toBe(f.page.id);
		expect(
			GetActiveContextOutputSchema.parse(
				await execute("get_active_context", { sessionId: f.input.sessionId }),
			).context.view.canvas?.textEditing,
		).toEqual(textEditingFixture);
		await f.publish({
			sequence: 2,
			view: {
				pageId: f.page.id,
				canvas: null,
				pageSelection: pageSelectionFixture,
			},
		});
		expect(
			GetActiveContextOutputSchema.parse(
				await execute("get_active_context", { sessionId: f.input.sessionId }),
			).context.view.pageSelection,
		).toEqual(pageSelectionFixture);
		const pageList = ListActiveSessionsOutputSchema.parse(
			await execute("list_active_sessions", {}),
		);
		expect(pageList.sessions[0]).toMatchObject({
			selectionCount: 2,
			selectionComplete: true,
		});
		expect(JSON.stringify(pageList)).not.toContain("First paragraph");
		expect(pageList.sessions[0]).not.toHaveProperty("pageSelection");
		await f.publish({
			sequence: 3,
			view: {
				pageId: f.page.id,
				canvas: null,
				pageSelection: {
					...pageSelectionFixture,
					selectionCount: 101,
					selectedBlockIds: Array.from({ length: 100 }, (_, i) => "block-" + i),
				},
			},
		});
		expect((await f.get()).context.selectionComplete).toBe(false);
		await expect(
			execute("get_active_context", { sessionId: crypto.randomUUID() }),
		).rejects.toMatchObject({ code: "ACTIVE_SESSION_NOT_FOUND" });
		await expect(
			execute("list_active_sessions", { workspaceId: "not-allowed" }),
		).rejects.toThrow();
		f.ctx.ports.members.findRole = async () => null;
		await expect(execute("list_active_sessions", {})).rejects.toThrow();
	} finally {
		f.database.close();
	}
});

test("rejects malformed and unbounded selection payloads", () => {
	expect(PublishContextInputSchema.safeParse({}).success).toBe(false);
	const selection = {
		canvasId: crypto.randomUUID(),
		canvasPageId: "page:one",
		selectedShapeIds: ["shape:a", "shape:a"],
		selectionCount: 2,
	};
	const input = {
		workspaceId: "workspace",
		expectedUserId: "user",
		sessionId: crypto.randomUUID(),
		sequence: 1,
		reportedAt: Date.now(),
		contextAgeMs: 0,
		visible: true,
		focused: true,
		view: { pageId: null, canvas: selection },
	};
	expect(PublishContextInputSchema.safeParse(input).success).toBe(false);
	selection.selectedShapeIds = Array.from(
		{ length: 101 },
		(_, i) => "shape:" + i,
	);
	selection.selectionCount = 101;
	expect(PublishContextInputSchema.safeParse(input).success).toBe(false);
});

test("Redis outages return a safe unavailable error", async () => {
	const f = await fixture();
	try {
		f.ctx.ports.liveContext.list = async () => {
			throw new Error("private connection details");
		};
		await expect(f.list()).rejects.toMatchObject({
			code: "LIVE_CONTEXT_UNAVAILABLE",
		});
	} finally {
		f.database.close();
	}
});
