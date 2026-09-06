import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskComposer } from "@/features/tasks/components/task-composer";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("compact task creation clears immediately and restores a rejected draft", async () => {
	const user = userEvent.setup({ document });
	let finish: ((result: { ok: false; error: string }) => void) | undefined;
	const request = new Promise<{ ok: false; error: string }>((resolve) => {
		finish = resolve;
	});
	const view = render(
		<TaskComposer
			currentUserId="user_1"
			mode="compact"
			onSubmit={() => request}
		/>,
	);
	const input = view.getByRole("textbox", { name: "Add a task" });
	await user.type(input, "Call Taylor");
	await user.click(view.getByRole("button", { name: "Add task" }));

	expect((input as HTMLInputElement).value).toBe("");
	finish?.({ ok: false, error: "Could not save task" });
	await waitFor(() =>
		expect((input as HTMLInputElement).value).toBe("Call Taylor"),
	);
	expect(view.getByRole("alert").textContent).toContain("Could not save task");
});
