import "@beignet/core/server-only";
import { z } from "zod";
import { appError } from "@/features/shared/errors";
import { requireActiveWorkspaceScope, requireUser } from "@/lib/auth";
import { useCase } from "@/lib/use-case";
import {
	MAX_RECOVERY_FILE_BYTES,
	RECOVERY_PART_BYTES,
	StageRecoveryPartInputSchema,
} from "../recovery";

export const stageRecoveryPartUseCase = useCase
	.command("documents.stageRecoveryPart")
	.input(StageRecoveryPartInputSchema)
	.output(z.object({ staged: z.literal(true) }))
	.run(async ({ ctx, input }) => {
		const scope = requireActiveWorkspaceScope(ctx, input.workspaceId);
		const user = requireUser(ctx);
		await ctx.gate.authorize("pages.create");
		const data = Buffer.from(input.data, "base64");
		if (
			input.part * RECOVERY_PART_BYTES + data.byteLength >
			MAX_RECOVERY_FILE_BYTES
		)
			throw appError("InvalidPageContent", {
				message: "Recovery files must be 5 MB or smaller.",
			});
		await ctx.ports.documents.stageRecoveryPart(
			scope,
			user.id,
			input.uploadId,
			input.part,
			data,
		);
		return { staged: true as const };
	});
