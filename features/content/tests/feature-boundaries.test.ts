import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findPageTaskDomainBoundaryViolations } from "@/scripts/check-feature-boundaries";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

async function fixtureRoot(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "haunter-feature-boundary-"));
	temporaryRoots.push(root);
	await Promise.all(
		Object.entries(files).map(async ([relative, source]) => {
			const file = path.join(root, relative);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, source);
		}),
	);
	return root;
}

describe("page/task domain boundaries", () => {
	it("keeps the application domain code runtime-independent", async () => {
		expect(await findPageTaskDomainBoundaryViolations()).toEqual([]);
	});

	it("rejects alias and relative runtime imports outside the UI layer", async () => {
		const root = await fixtureRoot({
			"pages/agent-capabilities.ts":
				'import { updateTask } from "@/features/tasks/use-cases/update-task";',
			"pages/lib/legacy.ts": 'require("../../tasks/schemas");',
			"tasks/use-cases/update-task.ts":
				'import { pagePolicy } from "../../pages/policy";',
		});

		expect(await findPageTaskDomainBoundaryViolations(root)).toEqual([
			"pages/agent-capabilities.ts:1 imports runtime code from features/tasks",
			"pages/lib/legacy.ts:1 imports runtime code from features/tasks",
			"tasks/use-cases/update-task.ts:1 imports runtime code from features/pages",
		]);
	});

	it("allows type-only ports and explicit UI composition", async () => {
		const root = await fixtureRoot({
			"pages/use-cases/save.ts":
				'import type { EmbeddedTaskProjectionPort } from "@/features/tasks/ports";',
			"pages/components/task-block.tsx":
				'import { taskSchema } from "@/features/tasks/schemas";',
		});

		expect(await findPageTaskDomainBoundaryViolations(root)).toEqual([]);
	});
});
