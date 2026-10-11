import "server-only";

import { isAppError } from "@beignet/core/errors";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSharedPageUseCase } from "@/features/shares/use-cases";
import { getAppRequestContext } from "@/lib/server-react-query";

// Deduplicate the page and metadata reads within one render, without caching
// across requests: revoked shares must be checked again on every visit.
export const getSharedPageOrNotFound = cache(async (token: string) => {
	const ctx = await getAppRequestContext();
	try {
		return await getSharedPageUseCase.run({ ctx, input: { token } });
	} catch (error) {
		if (isAppError(error) && error.code === "SHARE_NOT_FOUND") notFound();
		throw error;
	}
});
