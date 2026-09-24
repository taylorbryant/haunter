import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DocumentRecoveryNotice } from "../components/document-recovery-notice";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("recovery notices distinguish replacement, restore, and older unknown resets", () => {
	const session = {
		dismissRecoveryNotice: async () => {},
		recoveryDownload: async () => "{}",
	};
	const snapshot = {
		recoveries: [0],
		resetReason: "replacement" as const,
		recoveryNoticeDismissed: false,
	};
	const view = render(
		<DocumentRecoveryNotice snapshot={snapshot} session={session} />,
	);
	expect(view.getByText(/This page’s content was replaced/)).not.toBeNull();
	expect(view.queryByText(/This page was restored/)).toBeNull();
	view.rerender(
		<DocumentRecoveryNotice
			snapshot={{ ...snapshot, resetReason: "restore" }}
			session={session}
		/>,
	);
	expect(view.getByText(/This page was restored/)).not.toBeNull();
	view.rerender(
		<DocumentRecoveryNotice
			snapshot={{ ...snapshot, resetReason: null }}
			session={session}
		/>,
	);
	expect(
		view.getByText(/An earlier copy of this page is available/),
	).not.toBeNull();
});

test("dismissed notices can be reopened to select and download earlier copies", async () => {
	let dismissals = 0;
	const downloads: number[] = [];
	function Harness() {
		const [dismissed, setDismissed] = useState(false);
		return (
			<DocumentRecoveryNotice
				snapshot={{
					recoveries: [2, 0],
					resetReason: "replacement",
					recoveryNoticeDismissed: dismissed,
				}}
				session={{
					dismissRecoveryNotice: async () => {
						dismissals++;
						setDismissed(true);
					},
					recoveryDownload: async (generation = 2) => {
						downloads.push(generation);
						throw new Error("Test download failure");
					},
				}}
			/>
		);
	}
	const user = userEvent.setup({ document });
	const view = render(<Harness />);
	await user.click(view.getByRole("button", { name: "Dismiss notice" }));
	await waitFor(() => expect(view.queryByRole("status")).toBeNull());
	expect(dismissals).toBe(1);
	await user.click(view.getByRole("button", { name: "Previous copies (2)" }));
	await user.selectOptions(
		view.getByRole("combobox", { name: "Recovery copy" }),
		"0",
	);
	await user.click(
		view.getByRole("button", { name: "Download previous copy" }),
	);
	await waitFor(() => expect(downloads).toEqual([0]));
	expect(await view.findByRole("alert")).not.toBeNull();
});

test("failed dismissal keeps recovery controls available", async () => {
	const user = userEvent.setup({ document });
	const view = render(
		<DocumentRecoveryNotice
			snapshot={{
				recoveries: [0],
				resetReason: "restore",
				recoveryNoticeDismissed: false,
			}}
			session={{
				dismissRecoveryNotice: async () => {
					throw new Error("Quota");
				},
				recoveryDownload: async () => "{}",
			}}
		/>,
	);
	await user.click(view.getByRole("button", { name: "Dismiss notice" }));
	expect(await view.findByRole("alert")).not.toBeNull();
	expect(
		view.getByRole("button", { name: "Download previous copy" }),
	).not.toBeNull();
});
