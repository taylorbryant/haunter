import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import { activity } from "./page-activity-fixture";
import { receivePageAgentActivity } from "@/features/agents/client/page-activity-cache";
import { usePageAgents } from "@/features/agents/client/use-page-agents";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("agent popover stays closed until clicked, attributes activity, and closes on Escape", async () => {
	const { PageAgentPresence } = await import(
		"@/features/agents/components/page-agent-presence"
	);
	const user = userEvent.setup({ document });
	const view = render(<PageAgentPresence agents={[activity()]} />);
	const trigger = view.getByRole("button", { name: "Codex · Adding content" });
	expect(view.queryByText("Connected by Taylor")).toBeNull();
	await user.click(trigger);
	expect(view.getByText("Connected by Taylor")).not.toBeNull();
	expect(view.getByText("Agent")).not.toBeNull();
	expect(view.getByText("In progress")).not.toBeNull();
	view.rerender(
		<PageAgentPresence agents={[activity({ phase: "completed" })]} />,
	);
	expect(view.getByText("Added content just now")).not.toBeNull();
	expect(view.queryByText("In progress")).toBeNull();
	await user.keyboard("{Escape}");
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("multiple agents share one compact trigger and disappear when none remain", async () => {
	const { PageAgentPresence } = await import(
		"@/features/agents/components/page-agent-presence"
	);
	const user = userEvent.setup({ document });
	const view = render(
		<PageAgentPresence
			agents={[
				activity(),
				activity({
					agentId: "second",
					agentName: "Claude",
					userName: "Morgan",
					action: "read",
				}),
			]}
		/>,
	);
	await user.click(view.getByRole("button", { name: "2 agents on this page" }));
	expect(view.getByText("Codex")).not.toBeNull();
	expect(view.getByText("Claude")).not.toBeNull();
	expect(view.getByText("Connected by Morgan")).not.toBeNull();
	view.rerender(<PageAgentPresence agents={[]} />);
	expect(view.queryByRole("button")).toBeNull();
});

test.each([-300_000, 300_000])(
	"the rendered presence hook expires activity despite a %d ms wall-clock offset",
	async (offset) => {
		const queryClient = new QueryClient();
		const serverTime = Date.parse(activity().occurredAt);
		const wallClock = spyOn(Date, "now").mockReturnValue(serverTime + offset);
		const event = activity({
			phase: "completed",
			occurredAt: new Date(serverTime - 14_800).toISOString(),
		});
		function Probe() {
			const agents = usePageAgents("viewer", event.workspaceId, event.pageId);
			return <p>{agents.length ? "Agent visible" : "No agents"}</p>;
		}
		try {
			receivePageAgentActivity(
				queryClient,
				"viewer",
				event.workspaceId,
				event,
				{ serverTime, receivedAt: performance.now() },
			);
			const view = render(
				<QueryClientProvider client={queryClient}>
					<Probe />
				</QueryClientProvider>,
			);
			expect(view.getByText("Agent visible")).not.toBeNull();
			wallClock.mockReturnValue(serverTime - offset * 10);
			await waitFor(() => expect(view.getByText("No agents")).not.toBeNull());
		} finally {
			cleanup();
			queryClient.clear();
			wallClock.mockRestore();
		}
	},
);
