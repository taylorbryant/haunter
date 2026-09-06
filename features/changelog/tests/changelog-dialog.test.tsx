import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReleaseList } from "@/features/changelog/components/changelog-dialog";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(installTestDom);
afterEach(async () => {
	cleanup();
	await uninstallTestDom();
});

test("release rows expose their summary and select the requested release", async () => {
	const user = userEvent.setup({ document });
	const releases = [
		{
			version: "1.2.3",
			date: "2026-08-08",
			title: "Faster pages",
			sections: [{ title: "Improved", items: ["Pages open sooner."] }],
		},
		{
			version: "1.2.2",
			date: "2026-08-01",
			title: "Safer saves",
			sections: [{ title: "Fixed", items: ["Drafts recover reliably."] }],
		},
	] satisfies ChangelogRelease[];
	const selected: string[] = [];
	const view = render(
		<ReleaseList
			releases={releases}
			onSelect={(version) => selected.push(version)}
		/>,
	);

	expect(view.getByText("Pages open sooner.")).not.toBeNull();
	expect(view.getByText("Latest")).not.toBeNull();
	await user.click(view.getByRole("button", { name: /Safer saves/ }));
	expect(selected).toEqual(["1.2.2"]);
});
