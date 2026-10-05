import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { waitForTaskWrites } from "../client/wait-for-task-writes";
import { TASK_WRITE_KEY } from "../client/write-state";

function write(
	client: QueryClient,
	workspaceId: string,
	response: Promise<unknown>,
) {
	const mutation = client.getMutationCache().build(client, {
		mutationKey: TASK_WRITE_KEY,
		meta: {
			taskWrite: {
				workspaceId,
				userId: "user",
				taskId: crypto.randomUUID(),
				pageId: null,
			},
		},
		mutationFn: () => response,
	});
	return mutation.execute(undefined).catch(() => undefined);
}
test("workspace release waits for its task writes and reports failure, without waiting for other workspaces", async () => {
	const client = new QueryClient();
	const mine = Promise.withResolvers<void>();
	const other = Promise.withResolvers<void>();
	const pending = write(client, "mine", mine.promise);
	const foreign = write(client, "other", other.promise);
	let released = false;
	const check = waitForTaskWrites(client, "mine").then((saved) => {
		released = true;
		return saved;
	});
	await Promise.resolve();
	expect(released).toBeFalse();
	mine.resolve();
	expect(await check).toBeTrue();
	await pending;
	const failed = Promise.withResolvers<void>();
	const failure = write(client, "mine", failed.promise);
	const rejected = waitForTaskWrites(client, "mine");
	failed.reject(new Error("Offline"));
	expect(await rejected).toBeFalse();
	await failure;
	expect(await waitForTaskWrites(client, "other", 5)).toBeFalse();
	other.resolve();
	await foreign;
	client.clear();
});
