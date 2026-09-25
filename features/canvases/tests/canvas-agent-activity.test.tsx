import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { canvasActivity } from "@/features/agents/tests/canvas-activity-fixture";
import { useCanvasAgents } from "@/features/agents/client/use-canvas-agents";
import { receiveCanvasAgentActivity } from "@/features/agents/client/canvas-activity-cache";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("canvas feedback announces active, completed, and failed states and clears", async () => {
	const { CanvasAgentPresence } = await import(
		"../components/canvas-agent-activity"
	);
	const view = render(<CanvasAgentPresence agents={[canvasActivity()]} />);
	expect(view.getByRole("status").textContent).toContain(
		"Codex · TaylorUpdating canvas",
	);
	view.rerender(
		<CanvasAgentPresence agents={[canvasActivity({ phase: "completed" })]} />,
	);
	expect(view.getByRole("status").textContent).toContain("Updated canvas");
	view.rerender(
		<CanvasAgentPresence agents={[canvasActivity({ phase: "failed" })]} />,
	);
	expect(view.getByRole("status").textContent).toContain(
		"Canvas action failed",
	);
	view.rerender(<CanvasAgentPresence agents={[]} />);
	expect(view.getByRole("status").textContent).toBe("");
});

test("the rendered hook expires outlines before completion feedback despite a wrong browser clock", async () => {
	const queryClient = new QueryClient();
	const event = canvasActivity({
		phase: "completed",
		changedShapeIds: ["shape:a"],
	});
	const wallClock = spyOn(Date, "now").mockReturnValue(0);
	function Probe() {
		const { agents, shapeIds } = useCanvasAgents(
			"viewer",
			event.workspaceId,
			event.canvasId,
		);
		return (
			<p>
				{agents.length ? "Feedback" : "Empty"}{" "}
				{shapeIds.length ? "Outlined" : "Clear"}
			</p>
		);
	}
	try {
		receiveCanvasAgentActivity(
			queryClient,
			"viewer",
			event.workspaceId,
			event,
			{
				serverTime: Date.parse(event.occurredAt) + 5800,
				receivedAt: performance.now(),
			},
		);
		const view = render(
			<QueryClientProvider client={queryClient}>
				<Probe />
			</QueryClientProvider>,
		);
		expect(view.getByText("Feedback Outlined")).not.toBeNull();
		await waitFor(() =>
			expect(view.getByText("Feedback Clear")).not.toBeNull(),
		);
		receiveCanvasAgentActivity(
			queryClient,
			"viewer",
			event.workspaceId,
			{ ...event, operationId: crypto.randomUUID(), phase: "failed" },
			{
				serverTime: Date.parse(event.occurredAt) + 14_800,
				receivedAt: performance.now(),
			},
		);
		// Scope changes must immediately hide another canvas's activity.
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<Other />
			</QueryClientProvider>,
		);
		function Other() {
			const { agents } = useCanvasAgents("viewer", event.workspaceId, "other");
			return <p>{agents.length ? "Leaked" : "Other canvas"}</p>;
		}
		expect(view.getByText("Other canvas")).not.toBeNull();
	} finally {
		cleanup();
		queryClient.clear();
		wallClock.mockRestore();
	}
});
