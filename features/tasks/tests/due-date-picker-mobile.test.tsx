import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { DueDateValue } from "@/components/due-date-picker";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);

afterEach(() => {
	cleanup();
	uninstallTestDom();
});

test("mobile scheduling shows presets first and applies the draft when done", async () => {
	const { MobileDueDatePickerFields } = await import(
		"@/components/due-date-picker-mobile-fields"
	);
	const user = userEvent.setup({ document });
	const changes: DueDateValue[] = [];
	function Harness() {
		const [draft, setDraft] = useState<DueDateValue>({
			date: null,
			time: null,
			reminderOffsetMinutes: null,
		});
		return (
			<MobileDueDatePickerFields
				draft={draft}
				visibleMonth={new Date(2026, 7, 8)}
				presets={[
					{ label: "Today", date: new Date(2026, 7, 8) },
					{ label: "Tomorrow", date: new Date(2026, 7, 9) },
					{ label: "Next week", date: new Date(2026, 7, 10) },
					{ label: "Next weekend", date: new Date(2026, 7, 15) },
				]}
				onDraftChange={setDraft}
				onVisibleMonthChange={() => {}}
				onDone={() => changes.push(draft)}
			/>
		);
	}
	const view = render(<Harness />);

	const today = view.getByText("Today").closest("button");
	const tomorrow = view.getByText("Tomorrow").closest("button");
	const nextWeek = view.getByText("Next week").closest("button");
	const nextWeekend = view.getByText("Next weekend").closest("button");
	if (!today || !tomorrow || !nextWeek || !nextWeekend) {
		throw new Error("Date preset buttons did not render");
	}

	expect(
		today.compareDocumentPosition(tomorrow) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	expect(
		tomorrow.compareDocumentPosition(nextWeek) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	expect(
		nextWeek.compareDocumentPosition(nextWeekend) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	await user.click(tomorrow);
	await user.type(view.getByLabelText("Due time"), "09:00");
	await user.click(view.getByRole("button", { name: "Done" }));

	await waitFor(() => expect(changes).toHaveLength(1));
	expect(changes[0]).toEqual({
		date: "2026-08-09",
		time: "09:00",
		reminderOffsetMinutes: null,
	});
});
