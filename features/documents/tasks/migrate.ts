import { z } from "zod";
import { defineTask } from "@/lib/tasks";

export const MigrateTaskInputSchema = z.object({
	dryRun: z.boolean().default(true),
	expectedDatabase: z.string().optional(),
	backupPath: z.string().optional(),
});

export type MigrateTaskInput = z.infer<typeof MigrateTaskInputSchema>;

export const migrateTask = defineTask("documents.migrate", {
	input: MigrateTaskInputSchema,
	description:
		"Offline page cutover to Yjs and canvas cutover to tldraw sync. Dry-run validates all documents; apply requires target name and a new backup path. Stop app and worker writers first.",
	async handle({ input, ctx }) {
		return ctx.ports.documentMaintenance.migrate(input);
	},
});
