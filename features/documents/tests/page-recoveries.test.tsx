import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import * as Y from "yjs";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";
import {
	advanceDocumentGeneration,
	saveDocumentReceipt,
} from "../client/local-store";
import { PageDocumentSession } from "../client/session";
import { PageRecoveryNotice } from "../components/document-recovery-notice";
import { createPersistenceReceipt } from "../receipt";

const dependencies = { ...Dexie.dependencies };
const sessions: PageDocumentSession[] = [];
const cleanups: Array<() => void> = [];
beforeEach(() => {
	installTestDom();
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});
afterEach(async () => {
	cleanup();
	for (const clean of cleanups.splice(0).reverse()) clean();
	for (const session of sessions.splice(0)) await session.destroy(() => true);
	Object.assign(Dexie.dependencies, dependencies);
	await uninstallTestDom();
});

async function archivedSession(userId = "user") {
	const session = new PageDocumentSession({
		url: "ws://test",
		userId,
		workspaceId: "workspace",
		pageId: crypto.randomUUID(),
	});
	sessions.push(session);
	const doc = new Y.Doc();
	doc.getText("draft").insert(0, "Earlier unsynced edits");
	try {
		await advanceDocumentGeneration(
			session.identity.key,
			0,
			1,
			Y.encodeStateAsUpdate(doc),
		);
	} finally {
		doc.destroy();
	}
	return session;
}

function failReads() {
	const original = Dexie.prototype.transaction;
	let failing = true;
	const spy = spyOn(Dexie.prototype, "transaction").mockImplementation(
		function (this: Dexie, ...args: Parameters<typeof original>) {
			if (failing && args[0] === "r")
				return Dexie.Promise.reject(new Error("Transient read failure"));
			return original.apply(this, args);
		} as typeof original,
	);
	cleanups.push(() => spy.mockRestore());
	return () => {
		failing = false;
	};
}

test("a failed refresh preserves the recovery notice and offers a working explicit retry", async () => {
	const session = await archivedSession();
	const view = render(
		<PageRecoveryNotice session={session} onDismissed={() => {}} />,
	);
	await view.findByRole("button", { name: "Review copy" });
	const allowReads = failReads();
	await act(async () => {
		await saveDocumentReceipt(session.identity.key, 1, {
			...createPersistenceReceipt(session.doc),
			revision: 1,
		});
	});
	expect((await view.findByRole("alert")).textContent).toContain(
		"could not be read",
	);
	expect(view.getByRole("button", { name: "Review copy" })).not.toBeNull();
	const user = userEvent.setup({ document });
	await user.click(view.getByRole("button", { name: "Try again" }));
	expect(view.getByRole("button", { name: "Review copy" })).not.toBeNull();
	expect(view.getByRole("alert")).not.toBeNull();
	allowReads();
	await user.click(view.getByRole("button", { name: "Try again" }));
	// Formatting a Happy DOM node on every failed poll can block the read itself.
	await waitFor(() => expect(view.queryAllByRole("alert").length).toBe(0));
	expect(view.getByRole("button", { name: "Review copy" })).not.toBeNull();
	expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("an initial read failure offers retry and never exposes another identity's cached copies", async () => {
	const first = await archivedSession();
	const second = await archivedSession("other-user");
	const view = render(
		<PageRecoveryNotice session={first} onDismissed={() => {}} />,
	);
	await view.findByRole("button", { name: "Review copy" });
	const allowReads = failReads();
	view.rerender(<PageRecoveryNotice session={second} onDismissed={() => {}} />);
	await view.findByRole("alert");
	expect(view.queryByRole("button", { name: "Review copy" })).toBeNull();
	expect(view.queryByRole("status")).toBeNull();
	allowReads();
	await userEvent
		.setup({ document })
		.click(view.getByRole("button", { name: "Try again" }));
	await view.findByRole("button", { name: "Review copy" });
	expect(view.queryByRole("alert")).toBeNull();
});
