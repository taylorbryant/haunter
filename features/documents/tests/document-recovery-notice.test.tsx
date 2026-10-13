import { afterEach, beforeEach, expect, mock, test } from "bun:test";
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

test("confirmed saved copies are quiet; unsynced and older unknown copies can be reviewed", async () => {
	const onReview = mock((_generation: number) => {});
	const onDismiss = async () => {};
	const copy = {
		generation: 2,
		syncStatus: "saved" as const,
		dismissed: false,
	};
	const view = render(
		<DocumentRecoveryNotice
			copy={copy}
			onReview={onReview}
			onDismiss={onDismiss}
		/>,
	);
	expect(view.queryByRole("status")).toBeNull();
	for (const syncStatus of ["unsynced", "unknown"] as const) {
		view.rerender(
			<DocumentRecoveryNotice
				copy={{ ...copy, syncStatus }}
				onReview={onReview}
				onDismiss={onDismiss}
			/>,
		);
		expect(view.getByRole("status").textContent).toBe(
			"Earlier edits are saved on this device.",
		);
		await userEvent
			.setup({ document })
			.click(view.getByRole("button", { name: "Review copy" }));
	}
	expect(onReview.mock.calls).toEqual([[2], [2]]);
});

test("dismissal removes the notice without an extra collapsed banner", async () => {
	const dismiss = mock(async () => {});
	function Harness() {
		const [dismissed, setDismissed] = useState(false);
		return (
			<DocumentRecoveryNotice
				copy={{ generation: 0, syncStatus: "unsynced", dismissed }}
				onReview={() => {}}
				onDismiss={async () => {
					await dismiss();
					setDismissed(true);
				}}
			/>
		);
	}
	const view = render(<Harness />);
	await userEvent
		.setup({ document })
		.click(view.getByRole("button", { name: "Dismiss" }));
	await waitFor(() => expect(view.queryByRole("status")).toBeNull());
	expect(view.queryByRole("button")).toBeNull();
	expect(dismiss).toHaveBeenCalledTimes(1);
});

test("failed dismissal keeps review and retry available", async () => {
	const view = render(
		<DocumentRecoveryNotice
			copy={{ generation: 0, syncStatus: "unsynced", dismissed: false }}
			onReview={() => {}}
			onDismiss={async () => {
				throw new Error("Quota");
			}}
		/>,
	);
	await userEvent
		.setup({ document })
		.click(view.getByRole("button", { name: "Dismiss" }));
	expect(await view.findByRole("alert")).not.toBeNull();
	expect(view.getByRole("button", { name: "Review copy" })).not.toBeNull();
});
