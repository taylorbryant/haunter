"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { useDraftSafeRouter } from "@/client/use-draft-safe-router";
import { importRecovery } from "../contracts";
import { invalidateRecoveryImport } from "./queries";
import type { PageDocumentSession } from "./session";

type RecoveryAttempt = {
	idempotencyKey: string;
	file: string;
	pageId?: string;
};

export function useOpenRecoveryPage(
	workspaceId: string,
	session: Pick<PageDocumentSession, "recoveryDownload">,
) {
	const mutation = useMutation(
		rq(importRecovery).mutationOptions({ meta: { errorMode: "inline" } }),
	);
	const queryClient = useQueryClient();
	const router = useDraftSafeRouter();
	const attempts = useRef(new Map<number, RecoveryAttempt>());

	return async (generation: number) => {
		let attempt = attempts.current.get(generation);
		if (!attempt) {
			attempt = {
				idempotencyKey: crypto.randomUUID(),
				file: await session.recoveryDownload(generation),
			};
			// Keep both the key and payload unchanged after an unknown response,
			// even if another tab adds edits to the archived copy before retrying.
			attempts.current.set(generation, attempt);
		}
		if (!attempt.pageId) {
			const result = await mutation.mutateAsync({
				idempotencyKey: attempt.idempotencyKey,
				body: {
					workspaceId,
					filename: "haunter-previous-copy.json",
					file: attempt.file,
				},
			});
			if (!result.pages[0]) throw new Error("No recovered page was returned.");
			attempt.pageId = result.pages[0].id;
		}
		await invalidateRecoveryImport(queryClient, workspaceId);
		// Retain the result if local draft protection blocks this navigation.
		router.push(`/w/${workspaceId}/p/${attempt.pageId}`);
	};
}
