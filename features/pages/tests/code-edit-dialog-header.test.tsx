import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(() => {
	cleanup();
	uninstallTestDom();
});

test("code editor header changes language and closes from the same chrome", async () => {
	const [{ Dialog }, { CodeEditDialogHeader }] = await Promise.all([
		import("@/components/ui/dialog"),
		import("@/features/pages/components/editor/code-edit-dialog-header"),
	]);
	const user = userEvent.setup({ document });
	const languages: string[] = [];
	let closes = 0;
	const view = render(
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) closes += 1;
			}}
		>
			<CodeEditDialogHeader
				language="text"
				editable
				onLanguageChange={(language) => languages.push(language)}
			/>
		</Dialog>,
	);

	await user.selectOptions(
		view.getByRole("combobox", { name: "Code language" }),
		"typescript",
	);
	await user.click(view.getByRole("button", { name: "Close code editor" }));

	expect(languages).toEqual(["typescript"]);
	expect(closes).toBeGreaterThan(0);
});

test("read-only code keeps language selection disabled", async () => {
	const [{ Dialog }, { CodeEditDialogHeader }] = await Promise.all([
		import("@/components/ui/dialog"),
		import("@/features/pages/components/editor/code-edit-dialog-header"),
	]);
	const view = render(
		<Dialog open>
			<CodeEditDialogHeader
				language="text"
				editable={false}
				onLanguageChange={() => {}}
			/>
		</Dialog>,
	);

	expect(
		(
			view.getByRole("combobox", {
				name: "Code language",
			}) as HTMLSelectElement
		).disabled,
	).toBe(true);
});
